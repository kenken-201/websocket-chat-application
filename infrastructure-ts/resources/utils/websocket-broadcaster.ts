// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { MetricUnits } from '@aws-lambda-powertools/metrics';

// Helper class to send websocket messages to ALL connected users.
/**
 * resources/utils/websocket-broadcaster.ts は、WebSocket クライアント全体への
 * メッセージ送信を担当するユーティリティクラスです
 * このクラスは、リアルタイムチャットで 複数のクライアントに対して同時にメッセージを配信する機能を提供します
 * 具体的には以下の責任を持っています:
 * 1. DynamoDB からの接続情報の取得:
 *   WebSocket クライアントの接続情報（connectionId）を DynamoDB の connectionsTableName から取得
 * 2. メッセージの送信:
 *   取得した connectionId を用いて、AWS API Gateway の WebSocket API 経由でメッセージを送信
 * 3. 切断済み（無効）接続のクリーンアップ:
 *   メッセージ送信中にエラー（特に HTTP 410: Gone）が発生した場合、該当する接続を DynamoDB から削除
 * 4. メトリクスの収集:
 *   成功したメッセージ送信の数をカウントして、メトリクスに追加
 * 
 * 
 * 他のディレクトリやファイルとの関係
 * 1. resources/handlers/websocket/onmessage.ts:
 *   WebsocketBroadcaster クラスは、このファイルでインスタンス化され、メッセージブロードキャストに利用
 *   クライアントが送信したメッセージを他のクライアントに配信する主要な役割を担う
 * 2. bin/serverless-chat.ts:
 *   DynamoDB テーブル（connectionsTableName）や WebSocket API の設定を行い、このクラスの基盤を提供
 * 3. lib/websocket-stack.ts:
 *   connectionsTableName や messagesTableName の DynamoDB テーブルを定義
 *   onmessage.ts や他の Lambda 関数をスタックに統合
 * 4. resources/models/message.ts:
 *   WebSocket メッセージデータの型定義を提供
 *   broadcast メソッドでクライアントに送信するデータに利用可能
 * 5. resources/handlers/websocket/onconnect.ts:
 *   クライアントが接続時に connectionsTableName に接続情報を保存
 *   WebsocketBroadcaster がクライアントリストを取得するために依存
 * 
 * 
 * プロジェクト全体の流れ
 * 1. クライアントの接続 (onconnect.ts):
 *   WebSocket クライアントが接続
 *   接続情報が connectionsTableName テーブルに保存
 * 2. メッセージの送信 (onmessage.ts):
 *   クライアントがメッセージを送信
 *   メッセージが保存され、WebsocketBroadcaster 経由で他のクライアントに配信
 * 3. 切断処理 (ondisconnect.ts):
 *   クライアントが切断すると、接続情報が削除
 * 4. 状態の管理:
 *   メッセージの履歴は messagesTableName に保存され、再送信や監査に使用可能
 */
export class WebsocketBroadcaster {

    /**
     * クラス全体で利用する依存オブジェクトや設定値を初期化
     * 
     * @param AWS AWS SDK のインスタンス（Tracer でラップされたもの）
     * @param metrics メトリクス収集用（@aws-lambda-powertools/metrics）
     * @param dynamoDbClient dynamoDbClient: DynamoDB のクライアント
     * @param logger ログ記録用（@aws-lambda-powertools/logger）
     * @param connectionsTableName WebSocket 接続情報を格納している DynamoDB テーブル名
     */
    constructor(private AWS: any,
        private metrics: any,
        private dynamoDbClient: any,
        private logger: any,
        private connectionsTableName: string) { }

    private _apiGatewayEndpoint!: string;
    private _apigwManagementApi: any;

    /**
     * 接続情報の取得:
     *   DynamoDB の connectionsTableName テーブルから、全クライアントの connectionId を取得
     *   ProjectionExpression: 'connectionId' により必要な列（connectionId）のみを取得
     * 
     * @param payload 
     * @param apiGatewayEndpoint 
     */
    async broadcast(payload: any, apiGatewayEndpoint: string) {
        try {

            this.logger.debug('Retrieving active connections...');
            let connectionData = await this.dynamoDbClient.scan({ TableName: this.connectionsTableName, ProjectionExpression: 'connectionId' }).promise();
            this.logger.debug('ConnectionData:', connectionData);
            this.logger.debug(`Cached ApiGatewayEndpoint: ${this._apiGatewayEndpoint}`);
            this.logger.debug(`New ApiGatewayEndpoint: ${apiGatewayEndpoint}`);

            // API Gateway 管理クライアントの初期化:
            //   WebSocket メッセージ送信に使用する ApiGatewayManagementApi を、
            //  現在のエンドポイント（apiGatewayEndpoint）で初期化
            this._apigwManagementApi = new this.AWS.ApiGatewayManagementApi({ apiVersion: '2018-11-29', endpoint: apiGatewayEndpoint });

            // メッセージ送信:
            //   各 connectionId に対して、WebSocket メッセージ（payload）を送信
            //   成功時にはメトリクスをカウントし、ログを出力
            await Promise.all(connectionData.Items.map(async (connectionData: any) => {
                this.logger.debug(`Sending message to ${connectionData.connectionId}`);
                await this._apigwManagementApi.postToConnection({ ConnectionId: connectionData.connectionId, Data: JSON.stringify(payload) }).promise()
                    .then(()=> {
                        this.metrics.addMetric('messageDelivered', MetricUnits.Count, 1);
                        this.logger.debug(`Message sent to connection ${connectionData.connectionId}`);
                    })
                    .catch((err: any) => {
                        // postToConnection の送信でエラーが発生した場合、エラー内容をログに記録
                        // HTTP 410（切断済み接続）の場合、DynamoDB から該当する connectionId を削除
                        this.logger.debug(`Error during message delivery: ${JSON.stringify(err)}`);
                        if (err.statusCode === 410) {
                            this.logger.debug(`Found stale connection, deleting ${connectionData.connectionId}`);
                            this.dynamoDbClient.delete({ TableName: this.connectionsTableName, Key: { connectionData } });
                        }
                    });
            }));
            // 全クライアントへのメッセージ送信が完了したことをログに記録
            this.logger.debug(`All messages have been broadcasted.`);

        } catch (err: any) {
            // 想定外のエラーが発生した場合、ログに記録
            this.logger.debug("ERROR:", err);
        }
    }
}