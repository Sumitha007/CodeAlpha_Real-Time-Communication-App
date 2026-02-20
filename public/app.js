'use strict';

(function () {
  const socket = io();

  // ── DOM refs ───────────────────────────────────────────────
  const loginScreen   = document.getElementById('login-screen');
  const chatScreen    = document.getElementById('chat-screen');
  const usernameInput = document.getElementById('username-input');
  const roomInput     = document.getElementById('room-input');
  const joinBtn       = document.getElementById('join-btn');
  const leaveBtn      = document.getElementById('leave-btn');
  const roomLabel     = document.getElementById('room-label');
  const chatRoomTitle = document.getElementById('chat-room-title');
  const usersList     = document.getElementById('users-list');
  const messages      = document.getElementById('messages');
  const typingEl      = document.getElementById('typing-indicator');
  const messageInput  = document.getElementById('message-input');
  const sendBtn       = document.getElementById('send-btn');
  const mediaInput    = document.getElementById('media-input');

  let myUsername = '';
  let myRoom     = '';

  // ── Typing-indicator state ─────────────────────────────────
  const typingUsers = new Set();
  let typingTimeout = null;

  // ── Helpers ────────────────────────────────────────────────
  function showScreen(screen) {
    loginScreen.classList.remove('active');
    chatScreen.classList.remove('active');
    screen.classList.add('active');
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function appendSystem(text) {
    const el = document.createElement('div');
    el.className = 'system-msg';
    el.textContent = text;
    messages.appendChild(el);
    scrollToBottom();
  }

  function appendMessage({ username, text, timestamp }) {
    const isMe = username === myUsername;
    const row  = document.createElement('div');
    row.className = `msg-row ${isMe ? 'me' : 'other'}`;

    const meta   = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = `${isMe ? 'You' : username} • ${formatTime(timestamp)}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    row.appendChild(meta);
    row.appendChild(bubble);
    messages.appendChild(row);
    scrollToBottom();
  }

  function appendMedia({ username, url, mimetype, timestamp }) {
    const isMe  = username === myUsername;
    const row   = document.createElement('div');
    row.className = `msg-row ${isMe ? 'me' : 'other'}`;

    const meta  = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = `${isMe ? 'You' : username} • ${formatTime(timestamp)}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    let mediaEl;
    if (mimetype.startsWith('image/')) {
      mediaEl = document.createElement('img');
      mediaEl.src = url;
      mediaEl.alt = 'shared image';
      mediaEl.addEventListener('click', () => window.open(url, '_blank'));
    } else if (mimetype.startsWith('video/')) {
      mediaEl = document.createElement('video');
      mediaEl.src = url;
      mediaEl.controls = true;
    } else if (mimetype.startsWith('audio/')) {
      mediaEl = document.createElement('audio');
      mediaEl.src = url;
      mediaEl.controls = true;
    } else {
      mediaEl = document.createElement('a');
      mediaEl.href = url;
      mediaEl.target = '_blank';
      mediaEl.rel = 'noopener noreferrer';
      mediaEl.textContent = '📄 Download file';
    }

    bubble.appendChild(mediaEl);
    row.appendChild(meta);
    row.appendChild(bubble);
    messages.appendChild(row);
    scrollToBottom();
  }

  function updateTypingIndicator() {
    if (typingUsers.size === 0) {
      typingEl.textContent = '';
      return;
    }
    const names = [...typingUsers].join(', ');
    typingEl.textContent = `${names} ${typingUsers.size === 1 ? 'is' : 'are'} typing…`;
  }

  function updateUsersList(users) {
    usersList.innerHTML = '';
    users.forEach((name) => {
      const li = document.createElement('li');
      li.textContent = name;
      usersList.appendChild(li);
    });
  }

  // ── Join ───────────────────────────────────────────────────
  function join() {
    const username = usernameInput.value.trim();
    const room     = roomInput.value.trim();
    if (!username || !room) return;

    myUsername = username;
    myRoom     = room;

    roomLabel.textContent     = `# ${room}`;
    chatRoomTitle.textContent = `# ${room}`;

    socket.emit('join', { username, room });
    showScreen(chatScreen);
    messageInput.focus();
  }

  joinBtn.addEventListener('click', join);
  [usernameInput, roomInput].forEach((el) =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); })
  );

  // ── Leave ──────────────────────────────────────────────────
  leaveBtn.addEventListener('click', () => {
    socket.disconnect();
    socket.connect();
    messages.innerHTML = '';
    usersList.innerHTML = '';
    typingEl.textContent = '';
    typingUsers.clear();
    myUsername = '';
    myRoom     = '';
    showScreen(loginScreen);
    usernameInput.value = '';
    roomInput.value     = '';
  });

  // ── Send text message ──────────────────────────────────────
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    socket.emit('message', { text });
    messageInput.value = '';
    socket.emit('stop-typing');
    clearTimeout(typingTimeout);
  }

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Typing indicator emit ──────────────────────────────────
  messageInput.addEventListener('input', () => {
    if (!myRoom) return;
    socket.emit('typing');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop-typing'), 2000);
  });

  // ── Media upload ───────────────────────────────────────────
  mediaInput.addEventListener('change', async () => {
    const file = mediaInput.files[0];
    if (!file) return;
    mediaInput.value = '';

    const formData = new FormData();
    formData.append('media', file);

    try {
      const res  = await fetch('/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const { error } = await res.json();
        alert(`Upload failed: ${error}`);
        return;
      }
      const { url, mimetype } = await res.json();
      socket.emit('media', { url, mimetype });
    } catch (err) {
      console.error('Upload error:', err);
      alert('Upload failed. Please try again.');
    }
  });

  // ── Socket events ──────────────────────────────────────────
  socket.on('message', (data) => appendMessage(data));

  socket.on('media', (data) => appendMedia(data));

  socket.on('system', ({ message }) => appendSystem(message));

  socket.on('room-users', (users) => updateUsersList(users));

  socket.on('typing', ({ username }) => {
    typingUsers.add(username);
    updateTypingIndicator();
  });

  socket.on('stop-typing', ({ username }) => {
    typingUsers.delete(username);
    updateTypingIndicator();
  });

  socket.on('connect_error', () => {
    appendSystem('Connection lost. Reconnecting…');
  });

  socket.on('reconnect', () => {
    if (myUsername && myRoom) {
      socket.emit('join', { username: myUsername, room: myRoom });
    }
  });
}());
