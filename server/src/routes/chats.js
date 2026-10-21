/** Роуты чатов: список, создание, участники, отметки о прочтении. */
import { Router } from 'express';

import { AVATAR_PATTERN } from '../config.js';
import { authRequired } from '../auth.js';
import {
  addChatMember,
  chatIdsFor,
  createChat,
  findDm,
  getChatDetail,
  getChatRow,
  getUserById,
  isMember,
  markRead,
  memberIds,
  readMembers,
  removeChatMember,
  renameChat,
  setChatAvatar,
} from '../db.js';
import { getIo, isOnline } from '../realtime.js';
import { formatPhone } from '../phone.js';
import { num, str, route } from '../http.js';

const router = Router();
router.use(authRequired);

/** Добавляет флаг присутствия к участникам чата. */
function withPresence(chat) {
  if (!chat) return chat;
  return { ...chat, members: chat.members.map((m) => ({ ...m, online: isOnline(m.id) })) };
}

/** Рассылает актуальную карточку чата всем участникам. */
async function pushChat(chatId) {
  const io = getIo();
  if (!io) return;
  for (const uid of await memberIds(chatId)) {
    io.to(`user:${uid}`).emit('chat:new', withPresence(await getChatDetail(chatId, uid)));
  }
}

router.get(
  '/',
  route(async (req, res) => {
    const ids = await chatIdsFor(req.user.id);

    const chats = [];
    for (const id of ids) {
      const chat = withPresence(await getChatDetail(id, req.user.id));
      if (chat) chats.push(chat);
    }
    chats.sort((a, b) => b.updatedAt - a.updatedAt);

    res.json({ chats });
  })
);

router.post(
  '/',
  route(async (req, res) => {
    const type = req.body?.type === 'group' ? 'group' : 'dm';

    if (type === 'dm') {
      const otherId = num(req.body?.userId);
      if (!otherId || otherId === req.user.id) {
        return res.status(400).json({ error: 'Некорректный собеседник' });
      }
      if (!(await getUserById(otherId))) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }

      let chatId = await findDm(req.user.id, otherId);
      let created = false;
      if (!chatId) {
        const row = await createChat({ type: 'dm', members: [req.user.id, otherId] });
        chatId = row.id;
        created = true;
      }

      if (created) await pushChat(chatId);
      return res.json({ chat: withPresence(await getChatDetail(chatId, req.user.id)) });
    }

    // Группа
    const title = str(req.body?.title);
    if (!title || title.length > 64) {
      return res.status(400).json({ error: 'Название группы: от 1 до 64 символов' });
    }
    const rawMembers = Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(Number) : [];
    const members = [req.user.id];
    for (const uid of rawMembers) {
      if (uid !== req.user.id && (await getUserById(uid))) members.push(uid);
    }

    let avatar = null;
    if (req.body?.avatar) {
      if (!AVATAR_PATTERN.test(String(req.body.avatar))) {
        return res.status(400).json({ error: 'Некорректный аватар группы' });
      }
      avatar = String(req.body.avatar);
    }

    const row = await createChat({
      type: 'group',
      title,
      avatarPath: avatar,
      ownerId: req.user.id,
      members,
    });

    await pushChat(row.id);
    res.json({ chat: withPresence(await getChatDetail(row.id, req.user.id)) });
  })
);

router.get(
  '/:id',
  route(async (req, res) => {
    const chat = await getChatDetail(num(req.params.id), req.user.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    res.json({ chat: withPresence(chat) });
  })
);

router.patch(
  '/:id',
  route(async (req, res) => {
    const chatId = num(req.params.id);
    const row = await getChatRow(chatId);
    if (!row || !(await isMember(chatId, req.user.id))) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    if (row.type !== 'group') {
      return res.status(400).json({ error: 'Личный чат нельзя изменить' });
    }
    if (row.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Менять группу может только её создатель' });
    }

    if (req.body?.title !== undefined) {
      const title = str(req.body.title);
      if (!title || title.length > 64) {
        return res.status(400).json({ error: 'Название группы: от 1 до 64 символов' });
      }
      await renameChat(chatId, title);
    }

    if (req.body?.avatar !== undefined) {
      if (!req.body.avatar) await setChatAvatar(chatId, null);
      else if (!AVATAR_PATTERN.test(String(req.body.avatar))) {
        return res.status(400).json({ error: 'Некорректный аватар группы' });
      } else await setChatAvatar(chatId, String(req.body.avatar));
    }

    await pushChat(chatId);
    res.json({ chat: withPresence(await getChatDetail(chatId, req.user.id)) });
  })
);

router.post(
  '/:id/members',
  route(async (req, res) => {
    const chatId = num(req.params.id);
    const row = await getChatRow(chatId);
    if (!row || !(await isMember(chatId, req.user.id))) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    if (row.type !== 'group') {
      return res.status(400).json({ error: 'В личный чат участников не добавить' });
    }

    const raw = Array.isArray(req.body?.userIds) ? req.body.userIds.map(Number) : [];
    const added = [];
    for (const uid of raw) {
      if (uid === req.user.id || !(await getUserById(uid))) continue;
      await addChatMember(chatId, uid);
      added.push(uid);
    }

    await pushChat(chatId);
    res.json({ chat: withPresence(await getChatDetail(chatId, req.user.id)), added });
  })
);

router.delete(
  '/:id/members/:userId',
  route(async (req, res) => {
    const chatId = num(req.params.id);
    const userId = num(req.params.userId);
    const row = await getChatRow(chatId);
    if (!row || !(await isMember(chatId, req.user.id))) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    if (row.owner_id === userId) {
      return res.status(403).json({ error: 'Создатель не может покинуть группу' });
    }
    await removeChatMember(chatId, userId);

    await pushChat(chatId);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/read',
  route(async (req, res) => {
    const chatId = num(req.params.id);
    if (!(await isMember(chatId, req.user.id))) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    const messageId = num(req.body?.messageId);
    await markRead(chatId, req.user.id, messageId);

    const io = getIo();
    if (io) {
      for (const uid of await memberIds(chatId)) {
        if (uid === req.user.id) continue;
        io.to(`user:${uid}`).emit('message:read', { chatId, userId: req.user.id, messageId });
      }
    }
    res.json({ ok: true });
  })
);

router.get(
  '/:id/members',
  route(async (req, res) => {
    const chatId = num(req.params.id);
    if (!(await isMember(chatId, req.user.id))) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    const members = await readMembers(chatId);
    res.json({
      members: members.map((m) => ({
        id: m.id,
        phone: m.phone,
        phoneDisplay: formatPhone(m.phone),
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
