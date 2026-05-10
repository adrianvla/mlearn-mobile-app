const WORKER_API_URL = 'https://mlearn-cloud.kikan.net';

let accessToken = localStorage.getItem('mlearn_access_token') || '';
let refreshToken = localStorage.getItem('mlearn_refresh_token') || '';
let userId = localStorage.getItem('mlearn_user_id') || '';
let userEmail = localStorage.getItem('mlearn_user_email') || '';

function persistAuth() {
    localStorage.setItem('mlearn_access_token', accessToken);
    localStorage.setItem('mlearn_refresh_token', refreshToken);
    localStorage.setItem('mlearn_user_id', userId);
    localStorage.setItem('mlearn_user_email', userEmail);
}

function clearAuth() {
    accessToken = '';
    refreshToken = '';
    userId = '';
    userEmail = '';
    localStorage.removeItem('mlearn_access_token');
    localStorage.removeItem('mlearn_refresh_token');
    localStorage.removeItem('mlearn_user_id');
    localStorage.removeItem('mlearn_user_email');
}

export async function login(email, password) {
    const response = await fetch(`${WORKER_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Login failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data.session || !data.session.accessToken) {
        throw new Error('Invalid login response');
    }

    accessToken = data.session.accessToken;
    refreshToken = data.session.refreshToken || '';
    userId = data.user?.id || '';
    userEmail = data.user?.email || '';
    persistAuth();

    return { userId, userEmail };
}

export async function register(email, password) {
    const response = await fetch(`${WORKER_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Registration failed: ${response.status}`);
    }

    return true;
}

export async function refreshSession() {
    if (!refreshToken) {
        throw new Error('No refresh token available');
    }

    const response = await fetch(`${WORKER_API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
        clearAuth();
        throw new Error('Session refresh failed');
    }

    const data = await response.json();
    if (data.session) {
        accessToken = data.session.accessToken;
        refreshToken = data.session.refreshToken || refreshToken;
        persistAuth();
    }

    return accessToken;
}

export async function getCurrentUser() {
    if (!accessToken) {
        return null;
    }

    const response = await fetch(`${WORKER_API_URL}/api/auth/me`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        return null;
    }

    return response.json();
}

export function logout() {
    clearAuth();
}

export function getAccessToken() {
    return accessToken;
}

export function getRefreshToken() {
    return refreshToken;
}

export function getUserId() {
    return userId;
}

export function getUserEmail() {
    return userEmail;
}

export function isAuthenticated() {
    return !!accessToken;
}
