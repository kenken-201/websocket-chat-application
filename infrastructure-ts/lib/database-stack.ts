// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// aws-cdk-lib/aws-dynamodb: DynamoDBテーブルのプロパティを設定するためのライブラリ
// （例：AttributeType, BillingMode, TableEncryption）
// RemovalPolicy: テーブル削除時のポリシーを指定（本番環境では通常RETAINが推奨されます）
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * serverless-chat.ts との関係
 * テーブルの共有: DatabaseStackで作成されたDynamoDBテーブル
 * （connectionsTable, channelsTable, messagesTable）は、websocket-stack.tsや他のスタックに渡され、依存関係を解決します
 * 用途の具体例:
 *   connectionsTable: WebSocket接続ごとの情報を保存し、接続/切断イベントで利用
 *   messagesTable: メッセージ履歴を保存し、後から履歴を取得する機能に使用
 *   channelsTable: 複数クライアントをグループ化するために利用
 * websocket-stack.ts との関係
 *   接続と切断のイベント処理: connectionsTableがwebsocket-stack.tsで使用され、Lambda関数内で接続情報を管理
 *   メッセージ処理: messagesTableがメッセージ送受信時のデータ保存に利用
 */
export class DatabaseStack extends Stack {

  // messagesTable: メッセージ履歴を保存
  // channelsTable: チャネル（複数のWebSocketセッションのグループ）を保存
  // connectionsTable: 接続ごとのデータ（接続IDやクライアント情報）を保存
  readonly messagesTable: Table;
  readonly channelsTable: Table;
  readonly connectionsTable: Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.connectionsTable = new Table(this, 'Connections', {
      /**
       * partitionKey: 主キーはconnectionId（文字列）
       * BillingMode.PAY_PER_REQUEST: リクエストごとに課金される料金モデル（低トラフィックのシステムに適しています）
       * RemovalPolicy.DESTROY: スタック削除時にテーブルも削除（本番環境では通常RETAINが推奨されます）
       * TableEncryption.AWS_MANAGED: AWSが管理する暗号化キーを使用
       * pointInTimeRecovery: PITR（Point-In-Time Recovery）を無効化（必要に応じて有効化可能）
       */
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production use
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: false // set to "true" to enable PITR
    });

    this.channelsTable = new Table(this, 'serverless-chat-channels', {
      /**
       * partitionKey: 主キーはchannelName（チャネル名を一意に識別）
       * その他の設定: connectionsTableと同様
       */
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: 'serverless-chat-channels',
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production use
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: false // set to "true" to enable PITR
    });

    this.messagesTable = new Table(this, 'serverless-chat-messages', {
      /**
       * partitionKey: チャネルごとのメッセージを保存するため、channelIdをパーティションキーとして使用
       * sortKey: メッセージの送信日時をソートキーとして使用
       */
      partitionKey: {
        name: 'channelId',
        type: AttributeType.STRING
      },
      sortKey: {
        name: 'sentAt',
        type: AttributeType.STRING
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: 'serverless-chat-messages',
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production use
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: false // set to "true" to enable PITR
    });
  }
};