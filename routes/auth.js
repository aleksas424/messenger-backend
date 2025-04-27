const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

router.post('/register', upload.single('avatar'), async (req, res) => {
  const { username, email, password } = req.body;
  const avatar = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (username, email, password, avatar) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, avatar]
    );

    res.status(201).json({ message: 'User registered successfully', userId: result.insertId });
  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    await db.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [user.id]);

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, avatar: user.avatar, last_seen: user.last_seen },
    });
  } catch (err) {
    console.error('Error logging in:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [users] = await db.query('SELECT id, username, email, avatar, last_seen FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(users[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.get('/users', authMiddleware, async (req, res) => {
  const { search } = req.query;
  try {
    const [users] = await db.query(
      'SELECT id, username, email, avatar, last_seen FROM users WHERE (username LIKE ? OR email LIKE ?) AND id != ?',
      [`%${search}%`, `%${search}%`, req.user.id]
    );
    res.json(users);
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.get('/chats', authMiddleware, async (req, res) => {
  try {
    console.log('Fetching chats for user:', req.user.id);
    const [results] = await db.query(
      `SELECT 
         c.id, 
         c.is_group, 
         c.name, 
         c.pinned_message_id,
         cu.role, 
         (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.is_read = FALSE AND m.sender_id != ?) as unread_count,
         (SELECT m.message 
          FROM messages m 
          WHERE m.chat_id = c.id 
          ORDER BY m.created_at DESC 
          LIMIT 1) as last_message,
         (SELECT m.created_at 
          FROM messages m 
          WHERE m.chat_id = c.id 
          ORDER BY m.created_at DESC 
          LIMIT 1) as last_message_time,
         (SELECT u.username 
          FROM users u 
          JOIN chat_users cu2 ON u.id = cu2.user_id 
          WHERE cu2.chat_id = c.id AND cu2.user_id != ? AND c.is_group = FALSE
          LIMIT 1) as other_user,
         (SELECT u.avatar 
          FROM users u 
          JOIN chat_users cu2 ON u.id = cu2.user_id 
          WHERE cu2.chat_id = c.id AND cu2.user_id != ? AND c.is_group = FALSE
          LIMIT 1) as other_user_avatar
       FROM chats c 
       JOIN chat_users cu ON c.id = cu.chat_id 
       WHERE cu.user_id = ?`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );
    console.log('Chats fetched:', results);
    res.json(results);
  } catch (err) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.get('/messages/:chatId', authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  console.log(`Fetching messages for chat ${chatId} by user ${req.user.id}`);

  try {
    const [results] = await db.query(
      'SELECT * FROM chat_users WHERE chat_id = ? AND user_id = ?',
      [chatId, req.user.id]
    );
    if (results.length === 0) {
      console.log(`User ${req.user.id} is not a member of chat ${chatId}`);
      return res.status(403).json({ message: 'You are not a member of this chat' });
    }

    const [messages] = await db.query(
      'SELECT m.id, m.chat_id, m.sender_id, m.message, m.file_url, m.created_at, m.is_read, u.username AS sender_name ' +
      'FROM messages m ' +
      'JOIN users u ON m.sender_id = u.id ' +
      'WHERE m.chat_id = ? ' +
      'ORDER BY m.created_at ASC',
      [chatId]
    );
    console.log(`Messages fetched for chat ${chatId}:`, messages);
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.put('/messages/:chatId/read', authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  console.log(`Marking messages as read for chat ${chatId} by user ${req.user.id}`);

  try {
    const [results] = await db.query(
      'SELECT * FROM chat_users WHERE chat_id = ? AND user_id = ?',
      [chatId, req.user.id]
    );
    if (results.length === 0) {
      console.log(`User ${req.user.id} is not a member of chat ${chatId}`);
      return res.status(403).json({ message: 'You are not a member of this chat' });
    }

    const [result] = await db.query(
      'UPDATE messages SET is_read = TRUE WHERE chat_id = ? AND sender_id != ? AND is_read = FALSE',
      [chatId, req.user.id]
    );

    const io = req.app.get('socketio');
    io.to(chatId).emit('messages_read', { chat_id: chatId });

    console.log(`Messages marked as read for chat ${chatId}, updated: ${result.affectedRows}`);
    res.json({ message: 'Messages marked as read', updated: result.affectedRows });
  } catch (err) {
    console.error('Error marking messages as read:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.post('/messages', upload.single('file'), authMiddleware, async (req, res) => {
  const { chat_id, message } = req.body;
  const file_url = req.file ? `/uploads/${req.file.filename}` : null;
  console.log(`Sending message to chat ${chat_id} by user ${req.user.id}`);

  if (!chat_id || (!message && !file_url)) {
    console.log('Invalid message data:', { chat_id, message, file_url });
    return res.status(400).json({ message: 'Chat ID and either message or file are required' });
  }

  try {
    const [results] = await db.query(
      'SELECT * FROM chat_users WHERE chat_id = ? AND user_id = ?',
      [chat_id, req.user.id]
    );
    if (results.length === 0) {
      console.log(`User ${req.user.id} is not a member of chat ${chat_id}`);
      return res.status(403).json({ message: 'You are not a member of this chat' });
    }

    const [result] = await db.query(
      'INSERT INTO messages (chat_id, sender_id, message, file_url) VALUES (?, ?, ?, ?)',
      [chat_id, req.user.id, message || null, file_url]
    );

    const [newMessageData] = await db.query(
      'SELECT m.*, u.username AS sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?',
      [result.insertId]
    );
    const newMessage = newMessageData[0];

    const io = req.app.get('socketio');
    io.to(chat_id).emit('receive_message', newMessage);
    console.log(`Emitted receive_message to chat ${chat_id}:`, newMessage);

    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.put('/messages/:messageId', authMiddleware, async (req, res) => {
  const { messageId } = req.params;
  const { message } = req.body;

  try {
    const [messages] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (messages.length === 0) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const msg = messages[0];
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    await db.query('UPDATE messages SET message = ? WHERE id = ?', [message, messageId]);
    res.json({ message: 'Message updated successfully' });
  } catch (err) {
    console.error('Error editing message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.delete('/messages/:messageId', authMiddleware, async (req, res) => {
  const { messageId } = req.params;

  try {
    const [messages] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (messages.length === 0) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const msg = messages[0];
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    await db.query('DELETE FROM messages WHERE id = ?', [messageId]);
    res.json({ message: 'Message deleted successfully' });
  } catch (err) {
    console.error('Error deleting message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.post('/chats', authMiddleware, async (req, res) => {
  const { user_ids, is_group, name } = req.body;

  if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({ message: 'User IDs are required' });
  }

  if (is_group && !name) {
    return res.status(400).json({ message: 'Group name is required for group chats' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO chats (is_group, name) VALUES (?, ?)',
      [is_group || false, is_group ? name : null]
    );

    const chatId = result.insertId;
    const allUserIds = [...new Set([req.user.id, ...user_ids])];

    for (const userId of allUserIds) {
      await db.query(
        'INSERT INTO chat_users (chat_id, user_id, role) VALUES (?, ?, ?)',
        [chatId, userId, userId === req.user.id ? 'admin' : 'member']
      );
    }

    res.status(201).json({ message: 'Chat created successfully', chatId });
  } catch (err) {
    console.error('Error creating chat:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.post('/chats/:chatId/pin', authMiddleware, async (req, res) => {
  const { chatId } = req.params;
  const { messageId } = req.body;

  try {
    const [results] = await db.query(
      'SELECT * FROM chat_users WHERE chat_id = ? AND user_id = ?',
      [chatId, req.user.id]
    );
    if (results.length === 0) {
      return res.status(403).json({ message: 'You are not a member of this chat' });
    }

    const [messages] = await db.query('SELECT * FROM messages WHERE id = ? AND chat_id = ?', [messageId, chatId]);
    if (messages.length === 0) {
      return res.status(404).json({ message: 'Message not found in this chat' });
    }

    await db.query('UPDATE chats SET pinned_message_id = ? WHERE id = ?', [messageId, chatId]);
    res.json({ message: 'Message pinned successfully' });
  } catch (err) {
    console.error('Error pinning message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

router.post('/chats/:chatId/unpin', authMiddleware, async (req, res) => {
  const { chatId } = req.params;

  try {
    const [results] = await db.query(
      'SELECT * FROM chat_users WHERE chat_id = ? AND user_id = ?',
      [chatId, req.user.id]
    );
    if (results.length === 0) {
      return res.status(403).json({ message: 'You are not a member of this chat' });
    }

    await db.query('UPDATE chats SET pinned_message_id = NULL WHERE id = ?', [chatId]);
    res.json({ message: 'Message unpinned successfully' });
  } catch (err) {
    console.error('Error unpinning message:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

module.exports = router;