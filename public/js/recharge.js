// 充值页面脚本

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('rechargeForm');
    const submitBtn = document.getElementById('submitBtn');
    const loading = document.getElementById('loading');
    const remarkInput = document.getElementById('remark');
    const charCount = document.querySelector('.char-count');

    // 创建固定位置的通知容器
    const toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        z-index: 10000;
        min-width: 300px;
        max-width: 400px;
    `;
    document.body.appendChild(toastContainer);

    // 设置付款时间的默认值为当前时间
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('payment_time').value = now.toISOString().slice(0, 16);

    // 备注字数统计
    remarkInput.addEventListener('input', function() {
        const count = this.value.length;
        charCount.textContent = `${count}/200`;
        if (count > 200) {
            charCount.style.color = '#FF6B6B';
        } else {
            charCount.style.color = '#999';
        }
    });

    // 表单提交处理
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // 清除之前的错误状态
        clearErrors();

        // 验证表单
        if (!validateForm()) {
            return;
        }

        // 获取表单数据
        const formData = getFormData();

        // 禁用提交按钮，显示加载状态
        submitBtn.disabled = true;
        loading.style.display = 'block';

        try {
            const response = await fetch('/api/recharge/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (result.success) {
                showToast('success', result.message);
                // 清空表单
                form.reset();
                // 重置付款时间为当前时间
                const now = new Date();
                now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                document.getElementById('payment_time').value = now.toISOString().slice(0, 16);
                charCount.textContent = '0/200';
            } else {
                showToast('danger', result.message);
                if (result.errors) {
                    displayErrors(result.errors);
                }
            }
        } catch (error) {
            console.error('提交充值登记失败:', error);
            showToast('danger', '网络错误，请稍后再试');
        } finally {
            submitBtn.disabled = false;
            loading.style.display = 'none';
        }
    });

    // 交易单号输入自动转大写
    document.getElementById('transaction_id').addEventListener('input', function() {
        this.value = this.value.toUpperCase();
    });
});

// 验证表单
function validateForm() {
    let isValid = true;

    // 验证付款时间
    const paymentTime = document.getElementById('payment_time');
    if (!paymentTime.value) {
        showError(paymentTime, '请选择付款时间');
        isValid = false;
    }

    // 验证交易单号
    const transactionId = document.getElementById('transaction_id');
    const transactionIdPattern = /^[a-zA-Z0-9]{6}$/;
    if (!transactionId.value) {
        showError(transactionId, '请输入交易单号');
        isValid = false;
    } else if (!transactionIdPattern.test(transactionId.value)) {
        showError(transactionId, '交易单号必须为6位字母或数字');
        isValid = false;
    }

    // 验证付款金额
    const amount = document.getElementById('amount');
    if (!amount.value || parseFloat(amount.value) <= 0) {
        showError(amount, '请输入有效的付款金额');
        isValid = false;
    }

    // 验证游戏账号
    const gameAccount = document.getElementById('game_account');
    if (!gameAccount.value || gameAccount.value.length < 5 || gameAccount.value.length > 12) {
        showError(gameAccount, '游戏账号长度必须在5-12个字符之间');
        isValid = false;
    }

    // 验证角色名称
    const characterName = document.getElementById('character_name');
    if (!characterName.value) {
        showError(characterName, '请输入角色名称');
        isValid = false;
    }

    // 验证付款项
    const items = document.querySelectorAll('input[name="items"]:checked');
    const itemsFeedback = document.getElementById('items-feedback');
    if (items.length === 0) {
        itemsFeedback.style.display = 'block';
        isValid = false;
    }

    // 验证游戏分区
    const server = document.querySelector('input[name="server"]:checked');
    const serverFeedback = document.getElementById('server-feedback');
    if (!server) {
        serverFeedback.style.display = 'block';
        isValid = false;
    }

    return isValid;
}

// 获取表单数据
function getFormData() {
    const items = [];
    document.querySelectorAll('input[name="items"]:checked').forEach(checkbox => {
        items.push(checkbox.value);
    });

    const serverRadio = document.querySelector('input[name="server"]:checked');
    const server = serverRadio ? serverRadio.value : '';
    // 使用 toFixed(2) 确保金额精度正确
    const amount = parseFloat(document.getElementById('amount').value);
    const formattedAmount = Math.round(amount * 100) / 100;

    return {
        payment_time: document.getElementById('payment_time').value,
        transaction_id: document.getElementById('transaction_id').value.toUpperCase(),
        amount: formattedAmount,
        items: items,
        game_account: document.getElementById('game_account').value,
        character_name: document.getElementById('character_name').value,
        server: server,
        remark: document.getElementById('remark').value
    };
}

// 显示字段错误
function showError(input, message) {
    input.classList.add('is-invalid');
    const feedback = input.nextElementSibling;
    if (feedback && feedback.classList.contains('invalid-feedback')) {
        feedback.textContent = message;
        feedback.style.display = 'block';
    }
}

// 清除所有错误状态
function clearErrors() {
    document.querySelectorAll('.form-control').forEach(input => {
        input.classList.remove('is-invalid');
    });
    document.querySelectorAll('.invalid-feedback').forEach(feedback => {
        feedback.style.display = 'none';
    });
}

// 显示后端返回的错误
function displayErrors(errors) {
    errors.forEach(error => {
        const field = document.querySelector(`[name="${error.path}"]`);
        if (field) {
            showError(field, error.msg);
        }
    });
}

// 显示Toast通知
function showToast(type, message) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        background: ${type === 'success' ? 'rgba(40, 167, 69, 0.95)' : 'rgba(220, 53, 69, 0.95)'};
        color: #fff;
        padding: 16px 20px;
        border-radius: 8px;
        margin-bottom: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        border: 1px solid ${type === 'success' ? 'rgba(40, 167, 69, 0.6)' : 'rgba(220, 53, 69, 0.6)'};
        font-size: 15px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease;
        backdrop-filter: blur(10px);
    `;

    const icon = type === 'success' ? '' : '';
    const span = document.createElement('span');
    span.textContent = message; // 使用 textContent 防止 XSS
    toast.innerHTML = icon;
    toast.appendChild(span);

    toastContainer.appendChild(toast);

    // 5秒后自动消失
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 5000);

    // 添加动画样式
    if (!document.getElementById('toast-animation-style')) {
        const style = document.createElement('style');
        style.id = 'toast-animation-style';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
}
