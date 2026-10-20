/** Роуты чатов: список, создание, участники, отметки о прочтении. */
import { Router } from 'express';

import { AVATAR_PATTERN } from '../config.js';
import { authRequired } from '../auth.js';
import {
  createChat,
  db,
  findDm,
  getChatDetail,
  getChatRow,
  getUserById,
  isMember,
  markRead,
  memberIds,
  readMembers,
} from '../db.js';
import { getIo, isOnline } from '../realtime.js';
import { num, str, route } from '../http.js';

const router = Router();
router.use(authRequired);

/** Добавляет флаг присутствия к участникам чата. */
function withPresence(chat) {
  if (!chat) return chat;
  return { ...chat, members: chat.members.map((m) => ({ ...m, online: isOnline(m.id) })) };
}

/** Рассылает актуальную карточку чата всем участникам. */
function pushChat(chatId) {
  const io = getIo();
  if (!io) return;
  for (const uid of memberIds(chatId)) {
    io.to(`user:${uid}`).emit('chat:new', withPresence(getChatDetail(chatId, uid)));
  }
}

router.get(
  '/',
  route((req, res) => {
    const rows = db
      .prepare(
        `SELECT c.id FROM chats c JOIN chat_members m ON m.chat_id = c.id WHERE m.user_id = ?`
      )
      .all(req.user.id);

    const chats = rows
      .map((r) => withPresence(getChatDetail(r.id, req.user.id)))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    res.json({ chats });
  })
);

router.post(
  '/',
  route((req, res) => {
    const type = req.body?.type === 'group' ? 'group' : 'dm';

    if (type === 'dm') {
      const otherId = num(req.body?.userId);
      if (!otherId || otherId === req.user.id) {
        return res.status(400).json({ error: 'Некорректный собеседник' });
      }
      if (!getUserById(otherId)) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }

      let chatId = findDm(req.user.id, otherId);
      let created = false;
      if (!chatId) {
        const row = createChat({ type: 'dm', members: [req.user.id, otherId] });
        chatId = row.id;
        created = true;
      }

      if (created) pushChat(chatId);
      return res.json({ chat: withPresence(getChatDetail(chatId, req.user.id)) });
    }

    // Группа
    const title = str(req.body?.title);
    if (!title || title.length > 64) {
      return res.status(400).json({ error: 'Название группы: от 1 до 64 символов' });
    }
    const rawMembers = Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(Number) : [];
    const members = [...new Set([req.user.id, ...rawMembers.filter((uid) => getUserById(uid))])];

    let avatar = null;
    if (req.body?.avatar) {
      if (!AVATAR_PATTERN.test(String(req.body.avatar))) {
        return res.status(400).json({ error: 'Некорректный аватар группы' });
      }
      avatar = String(req.body.avatar);
    }

    const row = createChat({
      type: 'group',
      title,
      avatarPath: avatar,
      ownerId: req.user.id,
      members,
    });

    pushChat(row.id);
    res.json({ chat: withPresence(getChatDetail(row.id, req.user.id)) });
  })
);

router.get(
  '/:id',
  route((req, res) => {
    const chat = getChatDetail(num(req.params.id), req.user.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    res.json({ chat: withPresence(chat) });
  })
);

router.patch(
  '/:id',
  route((req, res) => {
    const chatId = num(req.params.id);
    const row = getChatRow(chatId);
    if (!row || !isMember(chatId, req.user.id)) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    if (row.type !== 'group') {
      return res.status(400).json({ error: 'Личный чат нельзя изменить' });
    }
    if (row.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Менять группу может только её создатель' });
    }

    const patch = {};
    if (req.body?.title !== undefined) {
      const title = str(req.body.title);
      if (!title || title.length > 64) {
        return res.status(400).json({ error: 'Название группы: от 1 до 64 символов' });
      }
      patch.title = title;
    }
    if (req.body?.avatar !== undefined) {
      if (!req.body.avatar) patch.avatar = null;
      else if (!AVATAR_PATTERN.test(String(req.body.avatar))) {
        return res.status(400).json({ error: 'Некорректный аватар группы' });
      } else patch.avatar = String(req.body.avatar);
    }

    db.prepare('UPDATE chats SET title = ?, avatar_path = ? WHERE id = ?').run(
      patch.title ?? row.title,
      patch.avatar === undefined ? row.avatar_path : patch.avatar,
      chatId
    );

    pushChat(chatId);
    res.json({ chat: withPresence(getChatDetail(chatId, req.user.id)) });
  })
);

router.post(
  '/:id/members',
  route((req, res) => {
    const chatId = num(req.params.id);
    const row = getChatRow(chatId);
    if (!row || !isMember(chatId, req.user.id)) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    if (row.type !== 'group') {
      return res.status(400).json({ error: 'В личный чат участников не добавить' });
    }

    const raw = Array.isArray(req.body?.userIds) ? req.body.userIds.map(Number) : [];
    const add = db.prepare(
      `INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, last_read_message_id, joined_at)
       VALUES (?, ?, 'member', 0, ?)`
    );

    const added = [];
    for (const uid of raw) {
      if (uid === req.user.id || !getUserById(uid)) continue;
      add.run(chatId, uid, Date.now());
      added.push(uid);
    }

    pushChat(chatId);
    res.json({ chat: withPresence(getChatDetail(chatId, req.user.id)), added });
  })
);

router.delete(
  '/:id/members/:userId',
  route((req, res) => {
    const chatId = num(req.params.id);
    const userId = num(req.params.userId);
    const row = getChatRow(chatId);
    if (!row || !isMember(chatId, req.user.id)) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    if (row.owner_id === userId) {
      return res.status(403).json({ error: 'Создатель не может покинуть группу' });
    }
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chatId, userId);

    pushChat(chatId);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/read',
  route((req, res) => {
    const chatId = num(req.params.id);
    if (!isMember(chatId, req.user.id)) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    const messageId = num(req.body?.messageId);
    markRead(chatId, req.user.id, messageId);

    const io = getIo();
    if (io) {
      for (const uid of memberIds(chatId)) {
        if (uid === req.user.id) continue;
        io.to(`user:${uid}`).emit('message:read', { chatId, userId: req.user.id, messageId });
      }
    }
    res.json({ ok: true });
  })
);

router.get(
  '/:id/members',
  route((req, res) => {
    const chatId = num(req.params.id);
    if (!isMember(chatId, req.user.id)) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    res.json({
      members: readMembers(chatId).map((m) => ({
        id: m.id,
        username: m.username,
        displayName: m.display_name,
        avatar: m.avatar_path || null,
        bio: m.bio || '',
        role: m.role,
        lastSeen: m.last_seen,
        online: isOnline(m.id),
      })),
    });
  })
);

export default router;
