const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/', authMiddleware, async (req, res) => {
  const { chat_id, sender_id, message } = req.body;
  let file_url = null;

  if (req.file) {
    file_url = `/uploads/${req.file.filename}`;
  }

  try {
    const [result] = await db.query(
      'INSERT INTO messages (chat_id, sender_id, message, file_url) VALUES (?, ?, ?, ?)',
      [chat_id, sender_id, message, file_url]
    );
    const [newMessage] = await db.query('SELECT * FROM messages WHERE id = ?', [result.insertId]);
    res.status(201).json(newMessage[0]);
  } catch (err) {
    console.error('Error creating message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.get('/:chatId/messages', authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  try {
    const [messages] = await db.query(
      'SELECT m.*, u.username as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.chat_id = ? ORDER BY m.created_at ASC',
      [chatId]
    );
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const userId = req.user.id;

  try {
    const [messages] = await db.query('SELECT * FROM messages WHERE id = ? AND sender_id = ?', [id, userId]);
    if (messages.length === 0) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    await db.query('UPDATE messages SET message = ?, updated_at = NOW() WHERE id = ?', [message, id]);
    const [updatedMessage] = await db.query('SELECT * FROM messages WHERE id = ?', [id]);
    if (updatedMessage.length === 0) {
      return res.status(404).json({ message: 'Message not found' });
    }
    res.json(updatedMessage[0]);
  } catch (err) {
    console.error('Error updating message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const [messages] = await db.query('SELECT * FROM messages WHERE id = ? AND sender_id = ?', [id, userId]);
    if (messages.length === 0) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    const [result] = await db.query('DELETE FROM messages WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Message not found' });
    }
    res.json({ message: 'Message deleted' });
  } catch (err) {
    console.error('Error deleting message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

module.exports = router;