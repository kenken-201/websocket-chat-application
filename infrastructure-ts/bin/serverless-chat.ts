#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import 'source-map-support/register';
import { AuthenticationStack } from '../lib/auth-stack';
import { DatabaseStack } from '../lib/database-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { RestApiStack } from '../lib/rest-api-stack';
import { WebsocketStack } from '../lib/websocket-stack';

/* If you don't specify 'env', this stack will be environment-agnostic.
 * Account/Region-dependent features and context lookups will not work,
 * but a single synthesized template can be deployed anywhere. */

/* Uncomment the next line to specialize this stack for the AWS Account
 * and Region that are implied by the current CLI configuration. */
// env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

/* Uncomment the next line if you know exactly what Account and Region you
 * want to deploy the stack to. */
// env: { account: '123456789012', region: 'us-east-1' },

/* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
/**
### **プロジェクト全体の流れ**
以下のような流れが予想されます：
1. **ユーザーがフロントエンドにアクセス**  
   - S3とCloudFrontでホストされるフロントエンドにユーザーがアクセスします

2. **認証（`auth-stack.ts`）**  
   - Cognitoを通じて認証し、トークンを取得します

3. **APIリクエスト（`rest-api-stack.ts`や`websocket-stack.ts`）**  
   - トークンを使用して、REST APIやWebSocket APIにリクエストを送信します

4. **イベント処理（`resources/handlers/`）**  
   - WebSocketイベントが発生し、DynamoDBへの記録や通知が行われます
     - クライアント接続（Connect） → onconnect.ts
     - クライアント切断（Disconnect） → ondisconnect.ts
     - メッセージ送信 → onmessage.ts
   - REST APIのリクエストが発生し、DynamoDBへの記録や通知が行われます
     - メッセージ取得 → getmessages.ts
     - チャンネル作成 → createchannel.ts
     - チャンネル削除 → deletechannel.ts
     - メッセージ送信 → sendmessage.ts
   - SQS を介して状態変更（オンライン/オフライン）の通知を送信します
   - 通知ブロードキャストを行うために、SQS キューを使用します
     - ユーザーのオンライン/オフライン状態を追跡するために、DynamoDB テーブルを使用します
     - SQS キューからメッセージを読み取り、各ユーザーに通知を送信します

5. **監視（`observability-stack.ts`）**  
   - CloudWatchを通じて、アプリケーションの動作を監視します
*/
const app = new cdk.App();

// CDK-NAG security checks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

// Sets the log level for the lambda functions
// Allowed values:
// DEBUG | INFO | WARN | ERROR
const LOG_LEVEL = "ERROR"; 

// フロントエンドアプリケーションでauth-stack.tsが作成したCognitoの認証情報（User Pool IDやClient ID）を使用します。
// WebSocket APIがユーザー認証を行う場合、Cognitoの認証トークンを検証します。
// REST APIが認証済みユーザーのみアクセス可能とする場合、Cognito Authorizerを設定します。 etc...
const authStack = new AuthenticationStack(app, 'AuthenticationStack', {});

const databaseStack = new DatabaseStack(app, 'DatabaseStack', {});

const websocketApiStack = new WebsocketStack(app, 'WebsocketStack', {
  logLevel: LOG_LEVEL,
  messagesTable: databaseStack.messagesTable,
  channelsTable: databaseStack.channelsTable,
  cognitoUserPoolId: authStack.cognitoUserPoolId,
  connectionsTable: databaseStack.connectionsTable
});
websocketApiStack.addDependency(databaseStack);
websocketApiStack.addDependency(authStack);

const restApiStack = new RestApiStack(app, 'RestApiStack', {
  logLevel: LOG_LEVEL,
  messagesTable: databaseStack.messagesTable,
  channelsTable: databaseStack.channelsTable,
  connectionsTable: databaseStack.connectionsTable,
  cognitoUserPoolId: authStack.cognitoUserPoolId,
  webSocketApi: websocketApiStack.webSocketApi
});
restApiStack.addDependency(authStack);
restApiStack.addDependency(websocketApiStack);
restApiStack.addDependency(databaseStack);

const frontendStack = new FrontendStack(app, 'FrontendStack', {
  restApi: restApiStack.restApi,
  websocketApi: websocketApiStack.webSocketApi,
  cognitoUserPoolId: authStack.cognitoUserPoolId,
  cognitoDomainPrefix: '' // Cognito domain prefix needs to be unique globally. Please fill in your domain prefix.
});
frontendStack.addDependency(restApiStack);

const observabilityStack = new ObservabilityStack(app, 'ObservabilityStack', {

});

// CDK-NAG rule supressions

NagSuppressions.addStackSuppressions(authStack, [
  { id: 'AwsSolutions-IAM4', reason: 'LambdaBasicExecutionRole has access to create and append to any CW log groups. Although this is not ideal, it does not pose a security risk for the sample.' },
  { id: 'AwsSolutions-IAM5', reason: 'SMS MFA is not enabled on the Userpool.' },
]);

NagSuppressions.addStackSuppressions(restApiStack, [
  { id: 'AwsSolutions-APIG1', reason: 'Access logging would incur additional cost. Not required for a sample.' },
  { id: 'AwsSolutions-APIG2', reason: 'Request validation in not mandatory in this case. It would improve the resiliency of the API, but not required for a sample.' },
  { id: 'AwsSolutions-APIG4', reason: 'API authorization has been implemented for the non-public method.' },
  { id: 'AwsSolutions-APIG6', reason: 'Access logging would incur additional cost. Not required for a sample.' },
  { id: 'AwsSolutions-COG4', reason: 'Cognito authorization has been implemented for the non-public method.' },
  { id: 'AwsSolutions-IAM4', reason: 'LambdaBasicExecutionRole has access to create and append to any CW log groups. Although this is not ideal, it does not pose a security risk for the sample.' },
  { id: 'AwsSolutions-IAM5', reason: 'LambdaBasicExecutionRole has access to create and append to any CW log groups. Although this is not ideal, it does not pose a security risk for the sample.' },
]);

NagSuppressions.addStackSuppressions(websocketApiStack, [
  { id: 'AwsSolutions-APIG1', reason: 'Access logging would incur additional cost. Not required for a sample.' },
  { id: 'AwsSolutions-APIG2', reason: 'Request validation in not mandatory in this case. It would improve the resiliency of the API, but not required for a sample.' },
  { id: 'AwsSolutions-APIG4', reason: 'API authorization has been implemented for the non-public method.' },
  { id: 'AwsSolutions-APIG6', reason: 'Access logging would incur additional cost. Not required for a sample.' },
  { id: 'AwsSolutions-COG4', reason: 'Cognito authorization has been implemented for the non-public method.' },
  { id: 'AwsSolutions-IAM4', reason: 'LambdaBasicExecutionRole has access to create and append to any CW log groups. Although this is not ideal, it does not pose a security risk for the sample.' },
  { id: 'AwsSolutions-IAM5', reason: 'LambdaBasicExecutionRole has access to create and append to any CW log groups. Although this is not ideal, it does not pose a security risk for the sample.' },
]);


NagSuppressions.addStackSuppressions(frontendStack, [
  { id: 'AwsSolutions-S1', reason: "Bucket access logs are disabled by design. It would incur unnecessary cost. Only static SPA files are stored in the bucket." },
  { id: 'AwsSolutions-S2', reason: "The bucket has public access blocked. (wrong error message?). It is only accessible via Cloudfront." },
  { id: 'AwsSolutions-S10', reason: "SSL is enforced in a resource policy." }
]);

NagSuppressions.addResourceSuppressionsByPath(
  frontendStack,
  '/FrontendStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/DefaultPolicy/Resource',
  [
    { id: 'AwsSolutions-IAM4', reason: 'CDK managed policy - does not affect production' },
    { id: 'AwsSolutions-IAM5', reason: 'CDK managed policy - does not affect production' }
  ]
);

NagSuppressions.addResourceSuppressionsByPath(
  frontendStack,
  '/FrontendStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/Resource',
  [
    { id: 'AwsSolutions-IAM4', reason: 'CDK managed policy - does not affect production' },
    { id: 'AwsSolutions-IAM5', reason: 'CDK managed policy - does not affect production' }
  ]
);

NagSuppressions.addResourceSuppressionsByPath(
  frontendStack,
  '/FrontendStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/Resource',
  [
    { id: 'AwsSolutions-L1', reason: 'CDK managed lambda - does not affect production' }
  ]
);