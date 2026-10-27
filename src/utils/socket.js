import { io } from 'socket.io-client';

let socketInstance = null;

export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      reconnectionDelay: 1000
    });
  }
  return socketInstance;
}

// Generate or retrieve persistent anonymous player token stored on device
export function getPlayerToken() {
  let token = localStorage.getItem('chillax_player_token');
  if (!token) {
    token = 'usr_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now().toString(36);
    localStorage.setItem('chillax_player_token', token);
  }
  return token;
}

// Store & retrieve last used nickname
export function getSavedNickname() {
  return localStorage.getItem('chillax_player_nickname') || '';
}

export function saveNickname(name) {
  if (name) {
    localStorage.setItem('chillax_player_nickname', name);
  }
}
