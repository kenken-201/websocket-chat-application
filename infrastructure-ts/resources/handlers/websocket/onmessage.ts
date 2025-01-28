// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// AWS SDK: DynamoDB や WebSocket API の操作に利用
// @aws-lambda-powertools: ログ、トレーシング、メトリクスを強化
import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { Message } from '../../models/message';
import { Payload } from '../../models/payload';
import { WebsocketBroadcaster } from '../../utils/websocket-broadcaster';

/**
 * CONNECTIONS_TABLE_NAME: WebSocket 接続情報を保存する DynamoDB テーブル名
 * MESSAGES_TABLE_NAME: メッセージ情報を保存する DynamoDB テーブル名
 * LOG_LEVEL: ログの出力レベル
 */
const { CONNECTIONS_TABLE_NAME, LOG_LEVEL, MESSAGES_TABLE_NAME } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const metrics = new Metrics({ namespace: 'websocket-chat'});
const AWS = tracer.captureAWS(require('aws-sdk'));
const ddb = tracer.captureAWSClient(new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION }));
const broadcaster = new WebsocketBroadcaster(AWS, metrics, ddb, logger, CONNECTIONS_TABLE_NAME!);

/**
 * resources/handlers/websocket/onmessage.ts は、WebSocket クライアントから送信されたメッセージを処理するための Lambda 関数です。このファイルは、リアルタイムチャットの中核的な役割を果たし、以下のような処理を担います：
 * 1. メッセージの受信と分類:
 *   クライアントが WebSocket 経由で送信したデータを受信
 *   データの型を判定して適切な処理を実行（この例では Message 型を処理）
 * 2. DynamoDB へのメッセージ保存:
 *   メッセージ情報を DynamoDB に保存することで、永続化を実現
 * 3. WebSocket クライアントへのブロードキャスト:
 *   保存したメッセージを全クライアントに送信することで、リアルタイムでのデータ共有を実現
 * 
 * 
 * 他のファイルやディレクトリとの関係
 * 1. bin/serverless-chat.ts:
 *   onmessage.ts Lambda 関数のデプロイやリソース構成を定義
 *   MESSAGES_TABLE_NAME や CONNECTIONS_TABLE_NAME の DynamoDB テーブルをプロビジョニング
 * 2. resources/models/message.ts:
 *   メッセージデータの型定義を提供
 *   本ファイルでは、Message モデルを processMessagePayload で使用
 * 3. resources/utils/websocket-broadcaster.ts:
 *   processMessagePayload 内で利用
 *   DynamoDB から WebSocket 接続情報を取得し、メッセージをクライアントに送信
 * 4. resources/handlers/websocket/onconnect.ts:
 *   クライアントが WebSocket に接続したとき、接続情報を DynamoDB に記録
 *   本ファイル（onmessage.ts）でのブロードキャスト処理と連携
 * 5. lib/websocket-stack.ts:
 *   本 Lambda 関数を含むスタックの定義
 *   API Gateway、DynamoDB テーブル、SQS キューなどのリソースを管理
 * 
 * 
 * プロジェクト全体の流れ
 * 1. WebSocket 接続 (onconnect.ts):
 *   クライアントが接続
 *   接続情報が DynamoDB に保存される
 * 2. メッセージ送信 (onmessage.ts):
 *   クライアントがメッセージを送信
 *   メッセージが DynamoDB に保存され、他のクライアントにブロードキャスト
 * 3. ステータス通知 (status-broadcast.ts):
 *   ユーザーのオンライン/オフライン状態が WebSocket 経由で通知
 * 4. 切断処理 (ondisconnect.ts):
 *   クライアントが切断すると、接続情報が削除
 */
class Lambda implements LambdaInterface {

  private _apiGatewayEndpoint!: string;

  /**
   * APIGatewayProxyEvent:
   *   WebSocket クライアントからのリクエストデータ（メッセージ本体）を受信
   * 処理の流れ:
   * 1. event.body のパース：受信したリクエストを JSON として解析
   * 2. postObject.type に基づく分岐：
   *   Message 型のデータであれば processMessagePayload を呼び出して処理
   *   未知の型であればログを出力して無視
   * 
   * @param event 
   * @param context 
   * @returns 
   */
  @tracer.captureLambdaHandler()
  public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "" };
    this._apiGatewayEndpoint = event.requestContext.domainName + '/' + event.requestContext.stage;
    logger.addContext(context);

    try {
      const postObject = JSON.parse(event.body || "").data as Payload;

      // Handle request based on the payload type.
      if (postObject.type == "Message") {
        await this.processMessagePayload(postObject as Message, this._apiGatewayEndpoint);

      } else  {
        logger.info("Unrecognised payload type - ignore processing.");
      }

      metrics.publishStoredMetrics();
    }
    catch (e: any) {
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }

  /**
   * DynamoDB への保存:
   *   受信したメッセージに一意の ID (messageId) を付与
   *   メッセージデータを DynamoDB の MESSAGES_TABLE_NAME に保存
   * ブロードキャスト:
   *   WebsocketBroadcaster を使用して、受信したメッセージをすべての WebSocket クライアントに送信
   * 
   * @param payload 
   * @param apiGatewayEndpoint 
   */
  async processMessagePayload(payload: Message, apiGatewayEndpoint: string) {
    payload.messageId = uuidv4();
    const messageParams = { TableName: MESSAGES_TABLE_NAME, Item: payload };
    logger.debug(`Inserting message details ${JSON.stringify(messageParams)}`);
    await ddb.put(messageParams).promise();
    logger.debug(`Broadcasting message details ${JSON.stringify(messageParams)}`);
    await broadcaster.broadcast(payload, apiGatewayEndpoint);
  }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
