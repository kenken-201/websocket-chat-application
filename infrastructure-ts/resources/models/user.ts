// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Status } from "./status";

/**
 * 役割: チャットアプリケーションのユーザーを表現
 * プロパティ:
 *   username: ユーザー名
 *   status: ユーザーの現在のステータス
 */
export class User {
    constructor(init?:Partial<User>) {
        Object.assign(this, init);
    }
    public username!: string;
    public status!: Status;
}