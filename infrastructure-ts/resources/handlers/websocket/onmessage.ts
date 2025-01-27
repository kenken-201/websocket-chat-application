// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

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
 * CONNECTIONS_TABLE_NAME: DynamoDB テーブル名（WebSocket 接続情報を保存）
 * APIGW_ENDPOINT: WebSocket API のエンドポイント URL
 * LOG_LEVEL: ログの出力レベル（例: DEBUG, INFO）
 * ddb: WebSocket 接続情報を取得・操作するために DynamoDB を利用
 * broadcaster: WebSocket 接続情報をもとに、メッセージをブロードキャストするためのユーティリティ
 */
const { CONNECTIONS_TABLE_NAME, LOG_LEVEL, MESSAGES_TABLE_NAME } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const metrics = new Metrics({ namespace: 'websocket-chat'});
const AWS = tracer.captureAWS(require('aws-sdk'));
const ddb = tracer.captureAWSClient(new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION }));
const broadcaster = new WebsocketBroadcaster(AWS, metrics, ddb, logger, CONNECTIONS_TABLE_NAME!);

/**
 * resources/handlers/websocket/onmessage.ts は、SQS キューから受け取ったユーザーの
 * ステータス変更イベント（StatusChangeEvent）を処理し、WebSocket クライアントにブロードキャストする Lambda 関数です
 * 
 * このファイルは、チャットアプリケーションのリアルタイム性を担保する重要な部分であり、特に以下の役割を果たします：
 * 1. SQS キューからイベントを受信:
 *   イベント（ユーザーのオンライン/オフラインの変更）を処理するトリガーとして機能
 * 2. WebSocket クライアントへのステータス通知:
 *   DynamoDB テーブルに保存された接続情報をもとに、特定の WebSocket 接続に対してイベントを配信
 */
class Lambda implements LambdaInterface {

  private _apiGatewayEndpoint!: string;

  /**
   * 処理の流れ:
   * 1. SQS イベントの受信:
   *   event.Records には SQS メッセージが格納されており、それぞれがステータス変更イベントを表す JSON
   * 2. イベントデータのパース:
   *   各レコードの body を StatusChangeEvent 型としてパース
   * 3. WebSocket ブロードキャスト:
   *   WebsocketBroadcaster ユーティリティを使用して、特定の WebSocket API クライアントにイベントを送信
   * 4. 並列処理:
   *   複数のレコードを非同期で並列処理
   * 5. エラーハンドリング:
   *   エラー発生時、HTTP ステータスコード 500 を返却し、スタックトレースをログとして記録
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

  async processMessagePayload(payload: Message, apiGatewayEndpoint: string) {
    payload.messageId = uuidv4();
    const messageParams = { TableName: MESSAGES_TABLE_NAME, Item: payload };
    logger.debug(`Inserting message details ${JSON.stringify(messageParams)}`);
    await ddb.put(messageParams).promise();
    logger.debug(`Broadcasting message details ${JSON.stringify(messageParams)}`);
    // DynamoDB から接続情報を取得
    // APIGW エンドポイントを利用して、指定されたクライアントにメッセージを送信
    await broadcaster.broadcast(payload, apiGatewayEndpoint);
  }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
