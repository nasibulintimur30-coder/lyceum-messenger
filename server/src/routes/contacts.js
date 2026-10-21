/** Роуты списка контактов. */
import { Router } from 'express';

import { authRequired } from '../auth.js';
import {
  addContact,
  getUserById,
  isContact,
  listContacts,
  publicUser,
  removeContact,
} from '../db.js';
import { isOnline } from '../realtime.js';
import { num, route } from '../http.js';

const router = Router();
router.use(authRequired);

router.get(
  '/',
  route(async (req, res) => {
    const users = await listContacts(req.user.id);
    res.json({
      contacts: users.map((u) => ({
        ...publicUser(u),
        online: isOnline(u.id),
      })),
    });
  })
);

router.post(
  '/',
  route(async (req, res) => {
    const contactId = num(req.body?.userId);
    if (!contactId) return res.status(400).json({ error: 'Не указан пользователь' });
    if (contactId === req.user.id) {
      return res.status(400).json({ error: 'Нельзя добавить самого себя' });
    }
    const contact = await getUserById(contactId);
    if (!contact) return res.status(404).json({ error: 'Пользователь не найден' });

    await addContact(req.user.id, contactId);
    res.json({
      contact: { ...publicUser(contact), online: isOnline(contact.id), isContact: true },
    });
  })
);

router.delete(
  '/:userId',
  route(async (req, res) => {
    await removeContact(req.user.id, num(req.params.userId));
    res.json({ ok: true });
  })
);

export default router;
