// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// APIGatewayProxyEvent: API Gatewayがトリガーしたイベント（接続時の情報を含む）
// APIGatewayProxyResult: API Gatewayへのレスポンス（ステータスコードとメッセージ）
// Powertoolsライブラリ: ロギング（Logger）、トレーシング（Tracer）、メトリクス（Metrics）を統合して効率的な監視を実現
// StatusChangeEventとStatus: ユーザーのステータス変更イベントを表すモデル
import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Status } from '../../models/status';
import { StatusChangeEvent } from '../../models/status-change-event';

/**
 * STATUS_QUEUE_URL: ステータス変更イベントを送信するSQSキューのURL
 * ONNECTIONS_TABLE_NAME: 接続情報を格納するDynamoDBテーブル名
 * metrics: メトリクス収集用のクライアント
 * ddb: DynamoDBクライアント。接続情報を保存するために利用
 * SQS: SQSクライアント。ステータス変更イベントを送信
 */
const { STATUS_QUEUE_URL, LOG_LEVEL, CONNECTIONS_TABLE_NAME } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const metrics = new Metrics({ namespace: 'websocket-chat' });
const AWS = tracer.captureAWS(require('aws-sdk'));
const ddb = tracer.captureAWSClient(new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION }));
const SQS = tracer.captureAWSClient(new AWS.SQS());

/**
 * onconnect.tsは、WebSocket接続時のイベントハンドラとして機能します
 * これは、クライアントがWebSocketサーバーに接続した際にトリガーされるAWS Lambda関数を定義しています
 * このファイルは、接続情報をDynamoDBに保存し、接続したユーザーのステータス変更（オンライン）
 * を他のコンポーネントに通知する役割を担っています
 * 
 * 接続情報の管理:
 *   接続時にconnectionId（WebSocket接続ID）とuserIdをDynamoDBテーブル（CONNECTIONS_TABLE_NAME）に保存します
 * ステータス変更通知:
 *   ユーザーの現在の状態（例: "オンライン"）を記録したイベントを生成し、Amazon SQSを使って他のコンポーネントに通知します
 * 監視とトラブルシューティング:
 *   AWS Lambda Powertoolsを使ったロギング、トレーシング、メトリクス収集機能を活用しています
 * 
 * 他のファイルやディレクトリとの関係性
 *   infrastructure-ts/lib/database-stack.ts:
 *   このファイルで作成されたconnectionsTable（DynamoDBテーブル）は、接続情報を保存する際に利用されています。
 *   infrastructure-ts/lib/websocket-stack.ts:
 *   このLambda関数（onconnect）はwebsocket-stack.tsで定義されたAPI GatewayのWebSocketエンドポイントにバインドされています。
 *   resources/models/status-change-event.ts:
 *   ステータス変更イベントのデータモデルを定義
 */
class Lambda implements LambdaInterface {
    @tracer.captureLambdaHandler()
    public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

        // デバッグ用にリクエストイベントとコンテキスト情報を記録
        logger.addContext(context);
        logger.debug(JSON.stringify(event));
        logger.debug(JSON.stringify(context));
        let response: APIGatewayProxyResult = { statusCode: 200, body: "OK" };
        let authenticatedCustomerId = event.requestContext.authorizer?.customerId;

        // 接続情報をDynamoDBに保存
        const putParams = {
            TableName: CONNECTIONS_TABLE_NAME,
            /**
             * connectionId: WebSocketの一意な接続ID
             * userId: 認証済みユーザーID（認証が実装されている場合に利用）
             */
            Item: {
                connectionId: event.requestContext.connectionId,
                userId: authenticatedCustomerId
            }
        };

        try {
            logger.debug(`Inserting connection details ${JSON.stringify(putParams)}`);
            await ddb.put(putParams).promise();

            // メトリクスの記録
            // 新しい接続イベントをカウントし、CloudWatchメトリクスに公開
            metrics.addMetric('newConnection', MetricUnits.Count, 1);
            metrics.publishStoredMetrics();

            // Prepare status change event for broadcast
            // ステータス変更イベントの通知を準備
            // StatusChangeEvent: ユーザーがオンラインになったことを示すイベント
            let statusChangeEvent = new StatusChangeEvent({
                userId: authenticatedCustomerId,
                currentStatus: Status.ONLINE,
                eventDate: new Date()
            });

            logger.debug("Putting status changed event in the SQS queue:", statusChangeEvent);
            // Put status change event to SQS queue
            // SQS: ステータス変更イベントを他のコンポーネントに配信
            let sqsResults = await SQS.sendMessage({
                QueueUrl: STATUS_QUEUE_URL,
                MessageBody: JSON.stringify(statusChangeEvent),
                MessageAttributes: {
                    Type: {
                        StringValue: 'StatusUpdate',
                        DataType: 'String',
                    },
                },
            }).promise();
            logger.debug("queue send result: ", sqsResults);
        } catch (error: any) {
            var body = error.stack || JSON.stringify(error, null, 2);
            response = { statusCode: 500, body: body };
        }

        return response;
    }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;