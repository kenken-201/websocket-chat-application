// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Payload } from "./payload";

/**
 * 役割: チャットアプリケーション内の個々のメッセージを表現
 * プロパティ:
 *   sender: メッセージを送信したユーザーの ID
 *   text: メッセージ本文
 *   sentAt: メッセージが送信された日時
 *   channelId: メッセージが関連付けられたチャンネルの ID
 *   messageId: メッセージ固有の ID
 */
export class Message extends Payload{
    constructor(init?:Partial<Message>) {
        super("Message");
        Object.assign(this, init);
    }
    
    public sender!: string;
    public text: string | undefined;
    public sentAt: Date | undefined;
    public channelId!: string;
    public messageId!: string;
}