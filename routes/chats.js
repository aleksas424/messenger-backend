const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const [chats] = await db.query(
      `SELECT c.*, 
              (SELECT GROUP_CONCAT(u.username) 
               FROM chat_users cu 
               JOIN users u ON cu.user_id = u.id 
               WHERE cu.chat_id = c.id) as users 
       FROM chats c 
       JOIN chat_users cu ON c.id = cu.chat_id 
       WHERE cu.user_id = ?`,
      [userId]
    );
    res.json(chats);
  } catch (err) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { is_group, name, user_ids } = req.body;
  const creatorId = req.user.id;

  try {
    const [result] = await db.query(
      'INSERT INTO chats (is_group, name) VALUES (?, ?)',
      [is_group || false, name || null]
    );
    const chatId = result.insertId;

    await db.query(
      'INSERT INTO chat_users (chat_id, user_id, role) VALUES (?, ?, ?)',
      [chatId, creatorId, 'admin']
    );

    if (user_ids && user_ids.length > 0) {
      const values = user_ids.map((userId) => [chatId, userId, 'member']);
      await db.query(
        'INSERT INTO chat_users (chat_id, user_id, role) VALUES ?',
        [values]
      );
    }

    const [newChat] = await db.query('SELECT * FROM chats WHERE id = ?', [chatId]);
    res.status(201).json(newChat[0]);
  } catch (err) {
    console.error('Error creating chat:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.put('/:id/pin', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { messageId } = req.body;
  const userId = req.user.id;

  try {
    const [chat] = await db.query(
      'SELECT * FROM chat_users WHERE chat_id = ? AND user_id = ? AND role = ?',
      [id, userId, 'admin']
    );
    if (chat.length === 0) {
      return res.status(403).json({ message: 'Only admins can pin messages' });
    }

    await db.query('UPDATE chats SET pinned_message_id = ? WHERE id = ?', [messageId, id]);
    res.json({ message: 'Message pinned' });
  } catch (err) {
    console.error('Error pinning message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.put('/:id/unpin', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const [chat] = await db.query(
      'SELECT * FROM chat_users WHERE chat_id = ? AND user_id = ? AND role = ?',
      [id, userId, 'admin']
    );
    if (chat.length === 0) {
      return res.status(403).json({ message: 'Only admins can unpin messages' });
    }

    await db.query('UPDATE chats SET pinned_message_id = NULL WHERE id = ?', [id]);
    res.json({ message: 'Message unpinned' });
  } catch (err) {
    console.error('Error unpinning message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

module.exports = router;