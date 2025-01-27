// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Channel } from '../../models/channel';

/**
 * CHANNELS_TABLE_NAME: DynamoDB テーブル名を指定（チャネル情報が格納されている）
 * LOG_LEVEL: ログ出力の詳細度
 * @aws-lambda-powertools の初期化:
 *  Logger: ログの記録に使用
 * Tracer: DynamoDB 呼び出しを含む AWS サービスのトレース情報を収集、AWS X-Ray を活用したトレーシングの設定
 * ddb: AWS SDK を使用して DynamoDB のデータにアクセスするクライアントを作成
 */
const { CHANNELS_TABLE_NAME, LOG_LEVEL } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const AWS = tracer.captureAWS(require('aws-sdk'));
const ddb = tracer.captureAWSClient(new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION }));

/**
 * このファイルは、REST API の /channels エンドポイントの 
 * POST リクエストを処理する AWS Lambda ハンドラーの実装です
 * このハンドラーは、リクエストのペイロード（event.body）を解析し、
 * 新しいチャネル情報を DynamoDB のテーブルに保存します
 * 機能概要
 *   目的: DynamoDB に新しいチャネル（id を含む）の情報を登録する
 *   入力: API Gateway 経由で受け取る POST リクエスト（APIGatewayProxyEvent）
 *   出力: 成功時はステータスコード 200、失敗時は 500 エラーを返す
 * 
 * 
 * 他のディレクトリやファイルとの関係性
 * infrastructure-ts/bin/serverless-chat.ts
 *   役割: AWS CDK アプリケーション全体のエントリーポイント
 *   関係性: このファイルが RestApiStack を作成し、POST /channels エンドポイントにこの Lambda 関数を紐付け
 * infrastructure-ts/lib/RestApiStack.ts
 *   役割: REST API のリソース（API Gateway、Lambda、IAM ロールなど）をプロビジョニング。
 *   関係性:
 *    POST /channels エンドポイントに対して、この Lambda ハンドラー（post-channels.ts）をアタッチ
 * resources/models/channel.ts
 *   役割: Channel 型を定義
 *   関係性: POST リクエストのデータ構造を規定
 * resources/handlers/rest/get-channels.ts
 *   役割: GET /channels エンドポイントのハンドラー
 *   関係性: post-channels.ts が新しいチャネルを登録し、そのデータを get-channels.ts を通じて取得可能になる
 * DynamoDB テーブルとの関係
 *   CHANNELS_TABLE_NAME:
 *    新しいチャネルの ID を格納
 *    これらのデータは、get-channels.ts を介して取得される
 * 
 * 
 * プロジェクト全体の流れ
 * 1. bin/serverless-chat.ts:
 *   アプリケーションの起点。全てのスタックを初期化
 * 2. lib/RestApiStack.ts:
 *   REST API の構造を定義（POST /channels のルーティングも含む）
 * 3. resources/handlers/rest/post-channels.ts:
 *   POST リクエストの処理ロジック
 * 4. resources/models/channel.ts:
 *   POST データの型を定義
 */
class Lambda implements LambdaInterface {
  @tracer.captureLambdaHandler()
  public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "" };

    logger.addContext(context);

    try {
      // クライアントが送信した JSON データを Channel 型（id を含む）として解析
      const postData: Channel = JSON.parse(event.body!);
      logger.debug(`POST data: ${JSON.stringify(postData)}`);

      // DynamoDB に新しいチャネルの id を保存する
      const channelParams = {
        TableName: CHANNELS_TABLE_NAME,
        Item: {
          id: postData.id
        }
      };

      logger.debug(`Inserting channel details ${JSON.stringify(channelParams)}`);
      await ddb.put(channelParams).promise();

      logger.debug(JSON.stringify(event));
      logger.debug('Post Channel executed successfully!');
    }
    catch (e: any) {
      // エラーが発生した場合は、500 ステータスコードとエラースタックを返す
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }
}

// Lambda クラスのインスタンスを生成し、そのハンドラー関数をエクスポート
export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
