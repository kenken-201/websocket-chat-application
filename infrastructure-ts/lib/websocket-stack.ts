// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { AnyPrincipal, Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';
import { join } from 'path';

// WebsocketPropsインターフェースは、スタックに渡すプロパティを定義します。
// messagesTable: メッセージを保存するDynamoDBテーブル。
// connectionsTable: 接続情報を保存するDynamoDBテーブル。
export interface WebsocketProps extends StackProps {
  messagesTable: Table;
  channelsTable: Table;
  connectionsTable: Table;
  cognitoUserPoolId: string;
  logLevel: string;
}

/**
 * このファイルは AWS CDK を用いて WebSocket API を構築するためのスタックを定義しています
 * WebSocket を利用したリアルタイム通信アプリケーションの中核となるリソース
 * （API Gateway、Lambda 関数、SQS、DynamoDB など）をセットアップします
 */
export class WebsocketStack extends Stack {

  public webSocketApi: WebSocketApi;

  constructor(scope: Construct, id: string, props?: WebsocketProps) {
    super(scope, id, props);

    // SQS queue for user status updates
    /**
     * SQS キューの作成
     * 目的: 
     *   クライアントの接続/切断イベント（ユーザーのオンライン/オフライン状態）を一時保存し、
     *   他の処理（例: ブロードキャスト通知）に渡すために使用されます
     * TLS 強制: 
     *   statusQueue では非 HTTPS（非 TLS）接続を拒否するポリシーが設定されています。
     * DLQ の警告抑制: 
     *   失敗したメッセージの保存先（DLQ）がない場合の警告を無視しています
     *   ここでは、状態更新が失敗しても致命的ではないためです
     */
    const statusQueue = new sqs.Queue(this, 'user-status-queue', {
      visibilityTimeout: Duration.seconds(30),      // default,
      receiveMessageWaitTime: Duration.seconds(20), // default
      encryption: sqs.QueueEncryption.KMS_MANAGED
    });
    // Enforce TLS calls from any services
    statusQueue.addToResourcePolicy(new PolicyStatement({
      effect: Effect.DENY,
      principals: [
          new AnyPrincipal(),
      ],
      actions: [
          "sqs:*"
      ],
      resources: [statusQueue.queueArn],
      conditions: {
          "Bool": {"aws:SecureTransport": "false"},
      },
    }));
    // Suppress Nag warning for missing DLQ
    NagSuppressions.addResourceSuppressions(
      statusQueue,
      [
        {
          id: 'AwsSolutions-SQS3',
          reason:
            "Supress warning about missing DLQ. DLQ is not mission-critical here, a missing status update won't cause service disruptuion.",
        },
      ],
      true
    );

    var ssmPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      resources: [
        `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/prod/cognito/clientid`,
      ],
    })

    /**
     * 共通 Lambda 関数のプロパティ
     * 
     * environment: 環境変数でテーブル名や SQS キューの URL を注入
     * depsLockFilePath: package-lock.json を指定し、Lambda 関数の依存ライブラリを確定
     * 依存ライブラリ: @aws-lambda-powertools 系ライブラリ、aws-jwt-verify などが設定されています
     * トレース: Lambda のトレースを有効化し、X-Ray を使用します
     */
    const nodeJsFunctionProps: NodejsFunctionProps = {
      bundling: {
        externalModules: [
        ],
        nodeModules: [
          '@aws-lambda-powertools/logger', 
          '@aws-lambda-powertools/tracer',
          'aws-jwt-verify',
          '@aws-lambda-powertools/metrics'
        ],
      },
      // Lambda関数の依存関係をロックするためのファイルを指定します
      depsLockFilePath: join(__dirname, '../resources/', 'package-lock.json'),
      // Lambda関数の環境変数を設定します
      environment: {
        CONNECTIONS_TABLE_NAME: props?.connectionsTable.tableName!,
        MESSAGES_TABLE_NAME: props?.messagesTable.tableName!,
        CHANNELS_TABLE_NAME: props?.channelsTable.tableName!,
        STATUS_QUEUE_URL: statusQueue.queueUrl,
        COGNITO_USER_POOL_ID: props?.cognitoUserPoolId!,
        LOG_LEVEL: props?.logLevel!
      },
      // Lambda関数のエントリポイントとなるファイルを指定します
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      tracing: Tracing.ACTIVE
    }

    const authorizerHandler = new NodejsFunction(this, "AuthorizerHandler", {
      // authorizer.ts: WebSocket接続時の認証処理を定義します
      // WebSocket 接続時の認証を担当する Lambda 関数
      // Cognito User Pool を利用した認証が実装されています
      entry: path.join(__dirname, `/../resources/handlers/websocket/authorizer.ts`),
      ...nodeJsFunctionProps
    });
    authorizerHandler.addToRolePolicy(ssmPolicyStatement);

    // 接続時、切断時、メッセージ送信時のイベントを処理します
    const onConnectHandler = new NodejsFunction(this, "OnConnectHandler", {
      // クライアントが WebSocket に接続した際の処理
      // DynamoDB connectionsTable に接続情報を保存し、statusQueue に「オンライン通知」を送信
      entry: path.join(__dirname, `/../resources/handlers/websocket/onconnect.ts`),
      ...nodeJsFunctionProps
    });
    props?.connectionsTable.grantReadWriteData(onConnectHandler);
    statusQueue.grantSendMessages(onConnectHandler);

    const onDisconnectHandler = new NodejsFunction(this, "OnDisconnectHandler", {
      // クライアントが WebSocket から切断した際の処理
      // DynamoDB connectionsTable から接続情報を削除し、statusQueue に「オフライン通知」を送信
      entry: path.join(__dirname, `/../resources/handlers/websocket/ondisconnect.ts`),
      ...nodeJsFunctionProps
    });
    props?.connectionsTable.grantReadWriteData(onDisconnectHandler);
    statusQueue.grantSendMessages(onDisconnectHandler);

    const onMessageHandler = new NodejsFunction(this, "OnMessageHandler", {
      // クライアントがメッセージを送信した際の処理
      // DynamoDB messagesTable にメッセージを保存し、statusQueue に「メッセージ通知」を送信
      entry: path.join(__dirname, `/../resources/handlers/websocket/onmessage.ts`),
      ...nodeJsFunctionProps
    });
    onMessageHandler.addToRolePolicy(ssmPolicyStatement);
    props?.connectionsTable.grantReadWriteData(onMessageHandler);
    props?.messagesTable.grantReadWriteData(onMessageHandler);

    // WebSocket API の作成
    // WebSocket API には、接続時、切断時、メッセージ送信時の Lambda 関数を紐付けます
    const authorizer = new WebSocketLambdaAuthorizer('Authorizer', authorizerHandler, { identitySource: ['route.request.header.Cookie'] });
    this.webSocketApi = new WebSocketApi(this, 'ServerlessChatWebsocketApi', {
      apiName: 'Serverless Chat Websocket API',
      // 接続ハンドラー: onConnectHandler を登録
      connectRouteOptions: { integration: new WebSocketLambdaIntegration("ConnectIntegration", onConnectHandler), authorizer },
      // 切断ハンドラー: onDisconnectHandler を登録
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration("DisconnectIntegration", onDisconnectHandler) },
      // デフォルトハンドラー: onMessageHandler を登録
      defaultRouteOptions: { integration: new WebSocketLambdaIntegration("DefaultIntegration", onMessageHandler) },
    });

    const prodStage = new WebSocketStage(this, 'Prod', {
      webSocketApi: this.webSocketApi,
      stageName: 'wss',
      autoDeploy: true,
    });

    nodeJsFunctionProps.environment!["APIGW_ENDPOINT"] = prodStage.url.replace('wss://', '');

    const userStatusBroadcastHandler = new NodejsFunction(this, "userStatusBroadcastHandler", {
      entry: path.join(__dirname, `/../resources/handlers/websocket/status-broadcast.ts`),
      ...nodeJsFunctionProps
    });
    // SQS イベントソースの設定
    // statusQueue からのイベント（接続/切断通知）を処理し、全ユーザーにブロードキャストする Lambda 関数
    userStatusBroadcastHandler.addEventSource(new SqsEventSource(statusQueue, {
      batchSize: 10, // default
      maxBatchingWindow: Duration.minutes(0),
      reportBatchItemFailures: true, // default to false
    }));
    statusQueue.grantConsumeMessages(userStatusBroadcastHandler);
    props?.connectionsTable.grantReadWriteData(userStatusBroadcastHandler);

    this.webSocketApi.grantManageConnections(onMessageHandler);
    this.webSocketApi.grantManageConnections(userStatusBroadcastHandler);
  }
}
