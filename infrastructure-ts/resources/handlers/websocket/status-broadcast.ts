// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyResult } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { StatusChangeEvent } from '../../models/status-change-event';
import { WebsocketBroadcaster } from '../../utils/websocket-broadcaster';

/**
 * CONNECTIONS_TABLE_NAME: DynamoDB テーブル名（WebSocket 接続情報を保存）
 * APIGW_ENDPOINT: WebSocket API のエンドポイント URL
 * LOG_LEVEL: ログの出力レベル（例: DEBUG, INFO）
 * ddb: WebSocket 接続情報を取得・操作するために DynamoDB を利用
 * broadcaster: WebSocket 接続情報をもとに、メッセージをブロードキャストするためのユーティリティ
 */
const { CONNECTIONS_TABLE_NAME, LOG_LEVEL, APIGW_ENDPOINT } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const metrics = new Metrics({ namespace: 'websocket-chat', serviceName: 'websocketMessagingService' });
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
 * 
 * 
 * serverless-chat.ts との関係性
 * serverless-chat.ts は、この Lambda 関数を含む WebSocket スタック全体を
 * 定義するプロジェクトのエントリポイントです
 * 1. Lambda 関数のデプロイ設定:
 *   status-broadcast Lambda は WebsocketStack 内で定義され、SQS イベントをトリガーとして設定
 *   DynamoDB テーブルや WebSocket API のエンドポイントも、このスタックでプロビジョニング
 * 2. 全体の流れへの影響:
 *   WebSocket API を通じてリアルタイムでステータス通知を行う処理の一部
 *   他の Lambda 関数（例: onmessage.ts, ondisconnect.ts）と協調して動作
 * 
 * 
 * プロジェクト全体の流れ
 * 1. クライアント接続:
 *   WebSocket 接続時に onconnect.ts がトリガーされ、接続情報を DynamoDB に保存
 * 2. イベントの発生:
 *   ユーザーがステータスを変更すると、その情報が SQS キューに送信
 * 3. ステータスブロードキャスト:
 *   status-broadcast.ts が SQS メッセージを処理し、WebSocket クライアントに通知
 */
class Lambda implements LambdaInterface {
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
  public async handler(event: SQSEvent, context: any): Promise<any> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "" };
    logger.addContext(context);

    try {
      logger.debug(`Triggered SQS processor lambda with payload: ${JSON.stringify(event)}`);
      logger.debug(`ApiGatewayUrl: ${APIGW_ENDPOINT}`);

      await Promise.all(event.Records.map(async (record: any) => {
        let statuschangeEvent = JSON.parse(record.body) as StatusChangeEvent;
        // DynamoDB から接続情報を取得
        // APIGW エンドポイントを利用して、指定されたクライアントにメッセージを送信
        await broadcaster.broadcast(statuschangeEvent, APIGW_ENDPOINT!);

        logger.debug(`Event record has been processed: ${record.body}`);
      }));
    }
    catch (e: any) {
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
