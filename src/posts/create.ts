const _ = require('lodash');

const meta = require('../meta');
const db = require('../database');
const plugins = require('../plugins');
const user = require('../user');
const topics = require('../topics');
const categories = require('../categories');
const groups = require('../groups');
const utils = require('../utils');

type CreateData = {
  content?: string;
  timestamp?: number | Date;
  isMain?: boolean;
  toPid?: string;
  ip?: string;
  handle?: string;
  uid?: string;
  tid?: string;
}

type PostData = {
  toPid?: string;
  handle?: string;
  isMain?: boolean;
  ip?: string;
  pid: string;
  uid: string;
  tid: string;
  cid?: string;
  content: string;
  timestamp: number | Date;
}

module.exports = function (Posts: { create: (data: CreateData) => Promise<unknown>, uploads:
{ sync: (pid: string) => unknown } }) {
    async function addReplyTo(postData: PostData, timestamp: number | Date) {
        if (!postData.toPid) {
            return;
        }
        await Promise.all([
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.sortedSetAdd(`pid:${postData.toPid}:replies`, timestamp, postData.pid),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.incrObjectField(`post:${postData.toPid}`, 'replies'),
        ]);
    }
    Posts.create = async (data: CreateData) => {
        // This is an internal method, consider using Topics.reply instead
        const { uid } = data;
        const { tid } = data;
        const content = data.content.toString();
        const timestamp = data.timestamp || Date.now();
        const isMain = data.isMain || false;

        if (!uid && parseInt(uid, 10) !== 0) {
            throw new Error('[[error:invalid-uid]]');
        }

        if (data.toPid && !utils.isNumber(data.toPid)) {
            throw new Error('[[error:invalid-pid]]');
        }

        // eslint-disable-next-line max-len
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const pid: string = await db.incrObjectField('global', 'nextPid');
        let postData: PostData = {
            pid: pid,
            uid: uid,
            tid: tid,
            content: content,
            timestamp: timestamp,
        };

        if (data.toPid) {
            postData.toPid = data.toPid;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (data.ip && meta.config.trackIpPerPost) {
            postData.ip = data.ip;
        }
        if (data.handle && !parseInt(uid, 10)) {
            postData.handle = data.handle;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let result: { post: PostData } = await plugins.hooks.fire('filter:post.create', { post: postData, data: data });
        postData = result.post;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.setObject(`post:${postData.pid}`, postData);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const topicData: { cid?: string, pinned: boolean } = await topics.getTopicFields(tid, ['cid', 'pinned']);
        postData.cid = topicData.cid;

        await Promise.all([
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.sortedSetAdd('posts:pid', timestamp, postData.pid),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.incrObjectField('global', 'postCount'),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            user.onNewPostMade(postData),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            topics.onNewPostMade(postData),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            categories.onNewPostMade(topicData.cid, topicData.pinned, postData),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            groups.onNewPostMade(postData),
            addReplyTo(postData, timestamp),
            Posts.uploads.sync(postData.pid),
        ]);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        result = await plugins.hooks.fire('filter:post.get', { post: postData, uid: data.uid });
        result.post.isMain = isMain;
        plugins.hooks.fire('action:post.save', { post: _.clone(result.post) }).catch((e: Error) => console.error(e));
        return result.post;
    };
};
