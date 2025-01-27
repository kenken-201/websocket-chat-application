// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { LambdaInterface } from '@aws-lambda-powertools/commons';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * MESSAGES_TABLE_NAME: メッセージを格納している DynamoDB テーブル名を指定
 * LOG_LEVEL: ログ出力の詳細度を設定
 * @aws-lambda-powertools の初期化:
 *   Logger: Lambda の動作中に発生するイベントを記録
 *   Tracer: AWS サービス呼び出しのトレース情報を収集（X-Ray 用）
 * ddb: AWS SDK を使用して、DynamoDB にクエリを実行するクライアントを作成
 */
const { MESSAGES_TABLE_NAME, LOG_LEVEL } = process.env;
const logger = new Logger({ serviceName: 'websocketMessagingService', logLevel: LOG_LEVEL });
const tracer = new Tracer({ serviceName: 'websocketMessagingService' });
const AWS = tracer.captureAWS(require('aws-sdk'));
const ddb = tracer.captureAWSClient(new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION }));

/**
 * このファイルは、指定されたチャネルに関連付けられたメッセージを DynamoDB から取得し、
 * HTTP レスポンスとして返す Lambda 関数を実装しています
 * REST API エンドポイントとして、API Gateway 経由で呼び出され、
 * チャネルの過去のメッセージをクライアントに提供します主に以下の役割を担います:
 * 1. REST リクエストの処理:
 *   クエリパラメータやパスパラメータから channelId を取得
 *   DynamoDB へのクエリを構築し、該当チャネルのメッセージを検索
 * 2. DynamoDB との連携:
 *   DynamoDB テーブル（環境変数 MESSAGES_TABLE_NAME）から、指定された channelId に基づくメッセージ一覧を取得
 * 3. エラーハンドリング:
 *   DynamoDB のクエリや Lambda 関数内でエラーが発生した場合、適切なエラーログを記録し、HTTP 500 エラーを返却
 * 4. メトリクスとトレース:
 *   @aws-lambda-powertools ライブラリを用いて、ログ記録・トレース情報の収集を行い、デバッグやモニタリングをサポート
 * 
 * 
 * 他のディレクトリやファイルとの関係性
 * 1. bin/serverless-chat.ts
 *  役割:
 *   このファイルは、プロジェクトのエントリーポイント
 *   AWS CDK アプリケーションのルートとして、各スタック（WebSocketStack や RestApiStack）を初期化
 *  関係性:
 *   get-channel-messages.ts を含む Lambda 関数が、RestApiStack 内で定義され、
 *   API Gateway のエンドポイントとしてデプロイされる
 * 2. lib/rest-api-stack.ts
 *  役割:
 *   REST API 用のスタックを構築
 *   このファイルで get-channel-messages.ts が Lambda 関数として指定され、
 *   API Gateway の /channel/{id}/messages エンドポイントに関連付けられる
 *  関係性:
 *   get-channel-messages.ts は、このスタックに依存し、REST API の一部を形成
 * 3. resources/models/message.ts
 *  役割:
 *   DynamoDB に保存されるメッセージデータの構造を定義
 *  関係性:
 *   get-channel-messages.ts は、この構造に基づいて DynamoDB から取得したデータを返す
 * 4. resources/utils/
 *  役割:
 *   共通ユーティリティ関数やクラスを提供
 *  関係性:
 *   logger や tracer を補助する独自ロジックがここに存在する可能性
 * 
 * 
 * プロジェクト全体の流れ
 * 1. クライアントが REST API を呼び出す:
 *   /channel/{id}/messages に対してリクエストを送信
 * 2. Lambda 関数がリクエストを処理:
 *   パスパラメータ（id）から channelId を取得
 *   DynamoDB にクエリを実行し、該当するメッセージを取得
 * 3. レスポンスを返却:
 *   取得したメッセージを HTTP 200 レスポンスとしてクライアントに返却
 */
class Lambda implements LambdaInterface {
  /**
   * @param event APIGatewayProxyEvent:
   *   API Gateway がリクエストを Lambda に渡す際のイベント情報
   *   パスパラメータやリクエストの詳細を格納
   * @param context 
   * @returns APIGatewayProxyResult: Lambda 関数が API Gateway に返すレスポンスの形式
   */
  @tracer.captureLambdaHandler()
  public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "OK" };
    logger.addContext(context);
    // channelId の取得:
    //   REST API の URL パスパラメータからチャネル ID を取得
    //   例: /channel/{id} の {id} 部分
    const channelId = decodeURIComponent(event.pathParameters?.id!);

    // DynamoDB クエリの準備:
    //   KeyConditionExpression を用いて、指定した channelId に基づくメッセージを検索
    //   ExpressionAttributeValues でプレースホルダーに具体的な値をマッピング
    var params = {
      TableName: MESSAGES_TABLE_NAME,
      KeyConditionExpression: "channelId = :channelId",
      ExpressionAttributeValues: {
        ":channelId": channelId
      }
    };

    logger.debug(JSON.stringify(event));

    try {
      // クエリ実行:
      //   DynamoDB から該当するメッセージ一覧を取得
      //   結果を HTTP 200 ステータスコードとともにクライアントに返却
      let messages = await ddb.query(params).promise();
      response = { statusCode: 200, body: JSON.stringify(messages.Items) };
    }
    catch (e: any) {
      // エラー処理:
      //   DynamoDB へのクエリや内部処理中に発生したエラーをキャッチ
      //   デバッグ用にエラー内容を記録し、クライアントには HTTP 500 ステータスコードを返却
      logger.debug(JSON.stringify(e));
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }
}

// エクスポート:
//   この Lambda 関数を他のモジュールや AWS に登録可能な形でエクスポート
export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
