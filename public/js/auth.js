// 通用工具函数

// 显示提示信息
function showAlert(type, message) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;

    alertContainer.innerHTML = '';
    alertContainer.appendChild(alertDiv);

    // 3秒后自动消失
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.parentNode.removeChild(alertDiv);
        }
    }, 3000);
}

// 验证邮箱格式
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// 验证手机号格式
function isValidPhone(phone) {
    const phoneRegex = /^1[3-9]\d{9}$/;
    return phoneRegex.test(phone);
}

// 验证身份证号格式
function isValidIDCard(idCard) {
    const idCardRegex = /^\d{17}[\dXx]$/;
    if (!idCardRegex.test(idCard)) return false;

    // 简单的校验码验证
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

    let sum = 0;
    for (let i = 0; i < 17; i++) {
        sum += parseInt(idCard[i]) * weights[i];
    }

    const checkCode = checkCodes[sum % 11];
    return idCard[17].toUpperCase() === checkCode;
}

// 获取客户端IP
function getClientIP() {
    return fetch('https://api.ipify.org?format=json')
        .then(response => response.json())
        .then(data => data.ip)
        .catch(() => '127.0.0.1');
}

// 格式化日期
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN');
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 检查用户是否登录
function checkAuth() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
}

// 更新导航菜单（根据登录状态）
function updateNavigation() {
    const user = checkAuth();
    const loginLink = document.querySelector('a[href="login.html"]');
    const dashboardLink = document.querySelector('a[href="dashboard.html"]');

    if (user) {
        // 已登录：隐藏登录链接，显示用户中心
        if (loginLink) {
            loginLink.style.display = 'none';
        }
        // 如果没有用户中心链接，添加一个
        if (!dashboardLink) {
            const nav = document.querySelector('.nav-links');
            if (nav) {
                const rechargeLink = nav.querySelector('a[href="recharge.html"]');
                const newLink = document.createElement('a');
                newLink.href = 'dashboard.html';
                newLink.textContent = '用户中心';
                newLink.className = 'nav-link-item';
                if (rechargeLink) {
                    nav.insertBefore(newLink, rechargeLink.nextSibling);
                }
            }
        }
    } else {
        // 未登录：显示登录链接，隐藏用户中心
        if (loginLink) {
            loginLink.style.display = '';
        }
        if (dashboardLink) {
            dashboardLink.style.display = 'none';
        }
    }
}

// 清除认证信息
function clearAuth() {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
}

// 通用API请求函数
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const mergedOptions = { ...defaultOptions, ...options };

    try {
        const response = await fetch(url, mergedOptions);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '请求失败');
        }

        return data;
    } catch (error) {
        console.error('API请求错误:', error);
        throw error;
    }
}

// 密码强度检测
function checkPasswordStrength(password) {
    if (!password) return 0;

    let strength = 0;

    // 长度检查
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;

    // 字符类型检查
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    return Math.min(strength, 4);
}

// 生成随机字符串
function generateRandomString(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // 添加页面加载动画
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';

    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);

    // 根据登录状态更新导航
    updateNavigation();
});