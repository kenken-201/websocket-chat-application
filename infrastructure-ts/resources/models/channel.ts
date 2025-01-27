// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { User } from "./user";

/**
 * 役割: チャットチャンネルを表現
 * プロパティ:
 *   id: チャンネル固有の ID
 *   Participants: チャンネルに参加しているユーザーのリスト
 */
export class Channel {
    public id!: string;
    public Participants!: User[];
}