// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * CHANNELS_TABLE_NAME: DynamoDB テーブル名を指定（チャネル情報が格納されている）
 * LOG_LEVEL: ログ出力の詳細度
 * @aws-lambda-powertools の初期化:
 *   Logger: ログの記録に使用
 *   Tracer: DynamoDB 呼び出しを含む AWS サービスのトレース情報を収集
 * ddb: AWS SDK を使用して DynamoDB のデータにアクセスするクライアントを作成
 */
const { CHANNELS_TABLE_NAME, LOG_LEVEL } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const AWS = tracer.captureAWS(require('aws-sdk'));
const ddb = tracer.captureAWSClient(new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION }));

/**
 * このファイルは、DynamoDB テーブルから利用可能なすべてのチャネル情報（名前のみ）を取得し、
 * クライアントに返す REST API 用 Lambda 関数を実装しています。主に以下の役割を果たします:
 * 1. DynamoDB のチャネル情報取得:
 *   DynamoDB テーブル（CHANNELS_TABLE_NAME）に保存されているチャネル情報を取得します
 *   取得時には ProjectionExpression を使用して、チャネル名（name フィールド）だけを選択
 * 2. エラーハンドリング:
 *   DynamoDB からのデータ取得時にエラーが発生した場合、エラーメッセージを HTTP 500 ステータスコードで返します
 * 3. ログ記録とトレース:
 *   @aws-lambda-powertools を使用して、リクエストおよび DynamoDB クエリのトレース、デバッグ情報を記録します
 * 4. HTTP レスポンス:
 *   成功時には、チャネル情報のリストを JSON フォーマットでクライアントに返します
 * 
 * 
 * 他のディレクトリやファイルとの関係性
 * 1. bin/serverless-chat.ts
 *  役割:
 *   AWS CDK アプリケーションのエントリーポイント
 *   スタック（RestApiStack や WebSocketStack）を初期化してデプロイします
 *  関係性:
 *   get-channel.ts を利用する Lambda 関数が、RestApiStack によって定義され、
 *   API Gateway のエンドポイントとしてデプロイされます
 * 2. lib/rest-api-stack.ts
 *  役割:
 *   REST API を構成する AWS リソース（API Gateway、Lambda 関数、IAM ロールなど）を定義
 *  関係性:
 *   このスタックにおいて、get-channel.ts は /channels のエンドポイントに関連付けられます
 * 3. resources/models/channel.ts
 *  役割:
 *   DynamoDB のチャネル情報の構造（スキーマ）を定義
 *  関係性:
 *   get-channel.ts が取得するデータは、このスキーマに基づいて保存されています
 * 4. resources/utils/
 *  役割:
 *   共通処理をモジュール化
 *   ログのフォーマットやトレースの初期化コードがここに含まれる可能性
 *  関係性:
 *   get-channel.ts 内の Logger や Tracer で共通ロジックを利用している場合があります
 * 
 * 
 * プロジェクト全体の流れ
 * 1. クライアントが REST API を呼び出す:
 *   /channels エンドポイントに GET リクエストを送信
 * 2. Lambda 関数が処理:
 *   DynamoDB の CHANNELS_TABLE_NAME から、チャネル名のリストを取得
 *   成功時にはチャネルリストを JSON レスポンスで返却
 * 3. エラー処理:
 *   DynamoDB のクエリでエラーが発生した場合、HTTP 500 エラーとエラーメッセージを返却
 */
class Lambda implements LambdaInterface {
  /**
   * @param event APIGatewayProxyEvent: API Gateway を経由して渡される HTTP リクエスト
   * @param context 
   * @returns APIGatewayProxyResult: Lambda 関数が API Gateway に返すレスポンス形式
   */
  @tracer.captureLambdaHandler()
  public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "OK" };
    logger.addContext(context);

    try {
      // DynamoDB クエリ:
      //   TableName: データを取得する DynamoDB テーブル名
      //   ProjectionExpression: 必要なフィールド（name）のみを取得する設定
      // レスポンスの生成:
      //   成功時に、取得したチャネル情報を HTTP 200 ステータスコードと共に返します
      let channels = await ddb.query({ TableName: CHANNELS_TABLE_NAME, ProjectionExpression: 'name' }).promise();
      response = { statusCode: 200, body: JSON.stringify(channels) };
      
      logger.debug(JSON.stringify(channels));
      logger.debug('Got channels!');
    }
    catch (e: any) {
      // エラーハンドリング:
      //   DynamoDB クエリ中に発生したエラーをキャッチし、
      //   デバッグ情報を記録した上で HTTP 500 エラーを返します
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }
}

// エクスポート:
//   この Lambda 関数を AWS や他のモジュールから参照できるようにエクスポート
export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
