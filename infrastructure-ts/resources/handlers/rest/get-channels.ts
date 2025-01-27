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
 * このファイルは、/channels エンドポイントの GET リクエストに対応する AWS Lambda ハンドラーの実装です
 * このエンドポイントでは、DynamoDB のテーブルから利用可能なチャンネルのリストを取得し、クライアントに返します
 * 機能概要
 *   目的: チャットアプリケーションにおいて、利用可能なチャンネル一覧を取得する
 *   入力: API Gateway からの GET リクエスト（APIGatewayProxyEvent）
 *   出力: チャンネルの ID 一覧を JSON 形式で返却する
 * 
 * 
 * 他のディレクトリやファイルとの関係性
 * infrastructure-ts/bin/serverless-chat.ts
 *   役割: AWS CDK アプリケーションのエントリーポイント
 *   このファイルは CDK アプリケーション全体を初期化し、RestApiStack やその他のスタックをデプロイします
 *   RestApiStack 内で /channels エンドポイントにこのハンドラーが紐付けられています
 * infrastructure-ts/lib
 *   役割: 各種 AWS リソースをプロビジョニングするスタックを定義
 *   RestApiStack がこのファイルと密接に関係しており、
 *   API Gateway でこの Lambda ハンドラーをエンドポイント /channels に統合しています
 * resources/handlers/rest
 *   役割: REST API の各エンドポイントに対応する Lambda ハンドラーを管理
 *   get-channels.ts は /channels に対応し、get-users.ts や post-channels.ts も類似の役割を果たします
 * resources 配下
 *   構成:
 *    handlers/: Lambda ハンドラーのコード
 *    package-lock.json: Lambda 関数用の依存関係を管理
 *   ハンドラー関数のビジネスロジックを格納し、リソースファイルとして利用
 * 
 * 
 * プロジェクト全体の流れ
 * 1. serverless-chat.ts:
 *   プロジェクトの起点として、各スタック（RestApiStack など）をデプロイ
 * 2. lib/RestApiStack.ts:
 *   REST API の全体構成を定義し、DynamoDB テーブルや Lambda 関数を紐付け
 * 3. resources/handlers/rest/get-channels.ts など:
 *   各エンドポイントに対応する具体的な処理を実装
 */
class Lambda implements LambdaInterface {
  /**
   * DynamoDB テーブル（CHANNELS_TABLE_NAME）を scan メソッドでスキャンし、チャンネルの ID 一覧を取得
   * 
   * @param event 
   * @param context 
   * @returns 
   *   レスポンスとして、取得したチャンネル一覧（channels.Items）を返却
   *   DynamoDB の操作が失敗した場合は、500 ステータスコードでエラースタックを返却
   */
  @tracer.captureLambdaHandler()
  public async handler(event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> {

    let response: APIGatewayProxyResult = { statusCode: 200, body: "OK" };
    logger.addContext(context);

    try {
      let channels = await ddb.scan({ TableName: CHANNELS_TABLE_NAME, ProjectionExpression: 'id' }).promise();
      response = { statusCode: 200, body: JSON.stringify(channels.Items) };

      logger.debug(JSON.stringify(channels));
    }
    catch (e: any) {
      response = { statusCode: 500, body: e.stack };
    }

    return response;
  }
}

export const handlerClass = new Lambda();
export const handler = handlerClass.handler;
