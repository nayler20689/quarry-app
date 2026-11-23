// تكوين Firebase الخاص بمشروعك
const firebaseConfig = {
    apiKey: "AIzaSyBAv3wyk1ONLYNg26ePLv3NaySH53J3jNs",
    authDomain: "quarry-management-system-6f034.firebaseapp.com",
    projectId: "quarry-management-system-6f034",
    storageBucket: "quarry-management-system-6f034.firebasestorage.app",
    messagingSenderId: "933605044706",
    appId: "1:933605044706:web:1bb04329cad15d6b77c9bb"
};

// تهيئة Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// تفعيل ميزة العمل بدون إنترنت (Offline Persistence)
db.enablePersistence()
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('فشل التفعيل: التبويبات متعددة');
        } else if (err.code == 'unimplemented') {
            console.log('المتصفح لا يدعم التخزين المؤقت');
        }
    });

// المراجع والمجموعات في قاعدة البيانات
const invoicesCollection = db.collection("invoices");
const repaymentsCollection = db.collection("repayments");
const expensesCollection = db.collection("expenses");
const quarriesCollection = db.collection("quarries");
const messagesCollection = db.collection("messages");

let currentEditId = null;
let activeDebtSubTab = null; // null = مطوي افتراضياً | 'approved' | 'new'
let latestArchiveInvoicesCache = [];

// ==========================================
// نظام العمل أوفلاين + طابور المزامنة للمشرف العام
// ==========================================
const OFFLINE_QUEUE_KEY = 'quarry_offline_sync_queue_v1';

function getOfflineQueue() {
    try {
        return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveOfflineQueue(queue) {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    updateOfflineSyncIndicator();
}

function enqueueOfflineAction(type, collectionName, payload, localId) {
    const queue = getOfflineQueue();
    const id = localId || (type + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    const existingIdx = queue.findIndex(item => item.queueId === id);
    const entryObj = {
        queueId: id,
        type: type, // 'invoice' | 'repayment' | 'expense' | 'quarry'
        collectionName: collectionName,
        payload: Object.assign({}, payload, { localId: id }),
        createdAt: Date.now()
    };
    if (existingIdx >= 0) {
        queue[existingIdx] = entryObj;
    } else {
        queue.push(entryObj);
    }
    saveOfflineQueue(queue);
}

function getPendingItemsByType(type, quarryName = '') {
    return getOfflineQueue()
        .filter(item => item.type === type)
        .filter(item => !quarryName || !item.payload || !item.payload.quarryName || item.payload.quarryName === quarryName)
        .map(item => Object.assign({}, item.payload, { _localId: item.queueId, _isOfflinePending: true }));
}

function updateOfflineSyncIndicator() {
    const queue = getOfflineQueue();
    let badge = document.getElementById('offlineSyncBadge');
    if (!badge) {
        if (!document.body) return;
        badge = document.createElement('div');
        badge.id = 'offlineSyncBadge';
        badge.style.cssText = 'position:fixed; bottom:12px; left:12px; z-index:9999; padding:8px 14px; border-radius:6px; font-size:12px; font-weight:bold; box-shadow:0 2px 8px rgba(0,0,0,0.2); cursor:pointer; display:none;';
        badge.title = 'اضغط لمحاولة مزامنة البيانات المعلقة الآن';
        badge.onclick = () => syncOfflineQueueToFirestore(true);
        document.body.appendChild(badge);
    }

    const isOnline = navigator.onLine;
    if (queue.length > 0) {
        badge.style.display = 'block';
        badge.style.background = isOnline ? '#f39c12' : '#c0392b';
        badge.style.color = '#fff';
        badge.innerText = isOnline
            ? `⏳ يوجد (${queue.length}) سجل بانتظار المزامنة للمشرف (اضغط للإرسال)`
            : `📴 وضع أوفلاين: (${queue.length}) سجل محفوظ محلياً وسيُرسل عند عودة النت`;
    } else if (!isOnline) {
        badge.style.display = 'block';
        badge.style.background = '#2c3e50';
        badge.style.color = '#fff';
        badge.innerText = '📴 أنت تعمل بدون إنترنت — الحفظ والطباعة مستمران محلياً';
    } else {
        badge.style.display = 'none';
    }
}

let isSyncingQueue = false;
window.syncOfflineQueueToFirestore = async function(showAlertIfEmpty = false) {
    if (isSyncingQueue) return;
    if (!navigator.onLine) {
        if (showAlertIfEmpty) {
            alert("لا يوجد اتصال بالإنترنت حالياً. البيانات محفوظة محلياً وستُرسل تلقائياً عند توفر الشبكة.");
        }
        updateOfflineSyncIndicator();
        return;
    }

    let queue = getOfflineQueue();
    if (queue.length === 0) {
        if (showAlertIfEmpty) {
            alert("جميع البيانات مرسلة ومزامَنة مع المشرف العام بالفعل.");
        }
        updateOfflineSyncIndicator();
        return;
    }

    isSyncingQueue = true;
    const remaining = [];

    for (const item of queue) {
        try {
            const targetCol = db.collection(item.collectionName);
            const docId = item.payload && item.payload.firestoreDocId ? item.payload.firestoreDocId : item.queueId;
            await targetCol.doc(docId).set(item.payload, { merge: true });
        } catch (err) {
            console.error("فشل مزامنة عنصر من الطابور:", item.queueId, err);
            remaining.push(item);
        }
    }

    saveOfflineQueue(remaining);
    isSyncingQueue = false;

    if (remaining.length === 0) {
        console.log("تمت مزامنة كافة البيانات المعلقة بنجاح إلى Firestore!");
        loadInvoices();
        loadDebtsTable();
        loadExpensesTable();
        calculateCashflow();
        loadDailyMaterialsStats();
        if (showAlertIfEmpty) {
            alert("تم إرسال كافة البيانات المعلقة إلى المشرف العام بنجاح!");
        }
    }
};

window.addEventListener('online', () => {
    updateOfflineSyncIndicator();
    syncOfflineQueueToFirestore(false);
});
window.addEventListener('offline', () => {
    updateOfflineSyncIndicator();
});

// التبديل بين التبويبات
window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const btns = document.querySelectorAll('.tab-btn');
    if (tabName === 'sales') {
        if (btns[0]) btns[0].classList.add('active');
        const el = document.getElementById('tabSales');
        if (el) el.classList.add('active');
    } else if (tabName === 'expenses') {
        if (btns[1]) btns[1].classList.add('active');
        const el = document.getElementById('tabExpenses');
        if (el) el.classList.add('active');
        loadExpensesTable();
    } else if (tabName === 'debts') {
        if (btns[2]) btns[2].classList.add('active');
        const el = document.getElementById('tabDebts');
        if (el) el.classList.add('active');
        loadDebtsTable();
    } else if (tabName === 'cashflow') {
        if (btns[3]) btns[3].classList.add('active');
        const el = document.getElementById('tabCashflow');
        if (el) el.classList.add('active');
        if (document.getElementById('cashDateFilter')) {
            document.getElementById('cashDateFilter').valueAsDate = new Date();
        }
        calculateCashflow();
    } else if (tabName === 'materials') {
        if (btns[4]) btns[4].classList.add('active');
        const el = document.getElementById('tabMaterials');
        if (el) el.classList.add('active');
        loadInvoices();
    } else if (tabName === 'archive') {
        if (btns[5]) btns[5].classList.add('active');
        const el = document.getElementById('tabArchive');
        if (el) el.classList.add('active');
        loadInvoices();
    } else if (tabName === 'chat') {
        if (btns[6]) btns[6].classList.add('active');
        const el = document.getElementById('tabChat');
        if (el) el.classList.add('active');
        loadChatMessages();
    }
};

// إضافة سطر مادة جديدة
const btnAddRowEl = document.getElementById('btnAddRow');
if (btnAddRowEl) {
    btnAddRowEl.addEventListener('click', function() {
        const tbody = document.getElementById('itemsBody');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <select class="item-name">
                    <option value="بحص صب">بحص صب</option>
                    <option value="خليط">خليط</option>
                    <option value="رمل صب">رمل صب</option>
                    <option value="زرادة عفاس">زرادة عفاس</option>
                    <option value="زرادة كسارة">زرادة كسارة</option>
                    <option value="نحاته ناعمة">نحاته ناعمة</option>
                    <option value="فرازة">فرازة</option>
                    <option value="كرابية">كرابية</option>
                    <option value="كرابية بلوك">كرابية بلوك</option>
                    <option value="مواد أخرى">مواد أخرى</option>
                </select>
            </td>
            <td><input type="number" class="item-qty" value="" min="0" placeholder=""></td>
            <td><input type="number" class="item-price" value="" min="0" placeholder=""></td>
            <td><input type="text" class="item-total" value="0.00 $" readonly></td>
            <td><button type="button" class="btn-del-row" onclick="removeRow(this)">X</button></td>
        `;
        tbody.appendChild(tr);
        attachEventsToRows();
    });
}

function removeRow(btn) {
    const tbody = document.getElementById('itemsBody');
    if (tbody.querySelectorAll('tr').length > 1) {
        btn.closest('tr').remove();
        calculateGrandTotal();
    }
}

function attachEventsToRows() {
    const rows = document.querySelectorAll('#itemsBody tr');
    rows.forEach(row => {
        const qty = row.querySelector('.item-qty');
        const price = row.querySelector('.item-price');
        if (qty) qty.oninput = calculateGrandTotal;
        if (price) price.oninput = calculateGrandTotal;
    });
}

function calculateGrandTotal() {
    const rows = document.querySelectorAll('#itemsBody tr');
    let totalAll = 0;

    rows.forEach(row => {
        const q = parseFloat(row.querySelector('.item-qty').value) || 0;
        const p = parseFloat(row.querySelector('.item-price').value) || 0;
        const total = q * p;

        const totalInput = row.querySelector('.item-total');
        if (totalInput) {
            totalInput.value = total.toFixed(2) + ' $';
        }
        totalAll += total;
    });

    const grandTotalEl = document.getElementById('grandTotal');
    if (grandTotalEl) {
        grandTotalEl.innerText = totalAll.toFixed(2) + ' $';
    }
}

// دالة توليد رقم الدور (تصفير تلقائي بيوم جديد أو عند تفريغ الأرشيف)
function generateQueueNumber() {
    const todayStrFixed = new Date().toLocaleDateString('en-CA');
    const lastSavedDate = localStorage.getItem('lastQueueDate');
    let lastQueueNum = parseInt(localStorage.getItem('lastQueueNum')) || 0;

    let queueNumber = 1;

    if (lastSavedDate === todayStrFixed && lastQueueNum > 0) {
        queueNumber = lastQueueNum + 1;
    } else {
        queueNumber = 1;
    }

    localStorage.setItem('lastQueueNum', queueNumber);
    localStorage.setItem('lastQueueDate', todayStrFixed);

    return `A-${queueNumber}`;
}

// حفظ الفاتورة والطباعة الفورية (يدعم العمل بدون إنترنت عبر طابور المزامنة)
const btnSaveAndPrintEl = document.getElementById('btnSaveAndPrint');
if (btnSaveAndPrintEl) {
    btnSaveAndPrintEl.addEventListener('click', function() {
        const customerName = document.getElementById('customerName').value.trim();
        const carNumber = document.getElementById('carNumber').value.trim();
        const paymentStatus = document.getElementById('paymentStatus').value;

        if (!customerName) {
            alert("يرجى إدخال اسم الشركة أولاً!");
            return;
        }

        const items = [];
        document.querySelectorAll('#itemsBody tr').forEach(row => {
            items.push({
                name: row.querySelector('.item-name').value,
                qty: parseFloat(row.querySelector('.item-qty').value) || 0,
                price: parseFloat(row.querySelector('.item-price').value) || 0,
                total: parseFloat(row.querySelector('.item-total').value.replace('$', '')) || 0
            });
        });

        const grandTotalText = document.getElementById('grandTotal').innerText;
        const numericGrandTotal = parseFloat(grandTotalText.replace('$', '')) || 0;

        const currentTurn = generateQueueNumber();
        const currentQueueNum = parseInt(localStorage.getItem('lastQueueNum')) || 1;

        const quarryName = localStorage.getItem('savedQuarryName') || document.getElementById('quarryName').value.trim() || 'مقلع غير مسمى';
        const quarryAddress = document.getElementById('quarryAddress').value.trim() || localStorage.getItem('savedQuarryAddress') || '---';
        const quarryPhone = document.getElementById('quarryPhone').value.trim() || localStorage.getItem('savedQuarryPhone') || '---';

        const localInvoiceId = 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

        const newInvoice = {
            localId: localInvoiceId,
            firestoreDocId: localInvoiceId,
            queueNumber: currentQueueNum,
            turnNumber: currentTurn,
            quarryName,
            quarryAddress,
            quarryPhone,
            date: new Date().toLocaleDateString('ar-SY'),
            isoDate: new Date().toLocaleDateString('en-CA'),
            customerName,
            carNumber: carNumber || '---',
            paymentStatus,
            items,
            grandTotal: numericGrandTotal,
            timestamp: Date.now()
        };

        // 1. تشغيل الطباعة والمعاينة فوراً وإضافة الوصل لقائمة آخر 5 إيصالات
        printInvoiceData(newInvoice);
        addRecentReceipt(newInvoice);

        // 2. الحفظ الفوري في الطابور المحلي ثم محاولة الإرسال للسحابة إذا كان الإنترنت متاحاً
        enqueueOfflineAction('invoice', 'invoices', newInvoice, localInvoiceId);
        loadInvoices();
        loadDebtsTable();
        calculateCashflow();
        loadDailyMaterialsStats();

        if (navigator.onLine) {
            invoicesCollection.doc(localInvoiceId).set(newInvoice, { merge: true })
                .then(() => {
                    const updatedQueue = getOfflineQueue().filter(q => q.queueId !== localInvoiceId);
                    saveOfflineQueue(updatedQueue);
                    console.log("تم حفظ الفاتورة ومزامنتها في السحابة بنجاح!");
                    loadInvoices();
                    loadDebtsTable();
                    calculateCashflow();
                    loadDailyMaterialsStats();
                })
                .catch((error) => {
                    console.warn("الفاتورة محفوظة محلياً وستُزامن لاحقاً:", error);
                });
        } else {
            console.log("تم حفظ الفاتورة محلياً في وضع عدم الاتصال (أوفلاين).");
        }

        resetForm();
    });
}

// إدارة قائمة آخر الإيصالات (تخزين حتى 5، وحذف الأقدم تلقائياً)
function addRecentReceipt(inv) {
    let recent = JSON.parse(localStorage.getItem('recent_receipts') || '[]');
    recent.push(inv);
    if (recent.length > 5) {
        recent.shift();
    }
    localStorage.setItem('recent_receipts', JSON.stringify(recent));
    renderRecentReceipts();
}

function renderRecentReceipts() {
    const section = document.getElementById('latestReceiptSection');
    const container = document.getElementById('recentReceiptsList');
    let recent = JSON.parse(localStorage.getItem('recent_receipts') || '[]');

    if (!section || !container) return;

    if (recent.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = '';

    recent.slice().reverse().forEach((inv, index) => {
        const actualIndex = recent.length - 1 - index;
        const itemDiv = document.createElement('div');
        itemDiv.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 8px 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 13px;";
        itemDiv.innerHTML = `
            <span>🧾 الزبون: <b>${inv.customerName}</b> - الدور (${inv.turnNumber}) - الإجمالي ($${Number(inv.grandTotal).toFixed(2)})</span>
            <div>
                <button type="button" onclick="printSpecificReceipt(${actualIndex})" style="background: #2980b9; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 5px;">🖨️ طباعة</button>
                <button type="button" onclick="deleteRecentReceipt(${actualIndex})" style="background: #e74c3c; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">🗑️ حذف</button>
            </div>
        `;
        container.appendChild(itemDiv);
    });
}

window.printSpecificReceipt = function(index) {
    let recent = JSON.parse(localStorage.getItem('recent_receipts') || '[]');
    if (recent[index]) {
        printInvoiceData(recent[index]);
    }
};

window.deleteRecentReceipt = function(index) {
    let recent = JSON.parse(localStorage.getItem('recent_receipts') || '[]');
    if (confirm("هل تريد إزالة هذا الإيصال من قائمة الإيصالات السريعة؟")) {
        recent.splice(index, 1);
        localStorage.setItem('recent_receipts', JSON.stringify(recent));
        renderRecentReceipts();
    }
};

function printInvoiceData(inv) {
    if (document.getElementById('pQuarryHeader')) document.getElementById('pQuarryHeader').innerText = inv.quarryName || 'مقلع غير مسمى';

    if (document.getElementById('pQuarryAddressPhone')) {
        const addr = inv.quarryAddress || localStorage.getItem('savedQuarryAddress') || '---';
        const phn = inv.quarryPhone || localStorage.getItem('savedQuarryPhone') || '---';
        document.getElementById('pQuarryAddressPhone').innerText = `العنوان: ${addr} | هاتف: ${phn}`;
    }

    if (document.getElementById('pDate')) document.getElementById('pDate').innerText = 'التاريخ: ' + (inv.date || '');
    if (document.getElementById('pQueueNum')) document.getElementById('pQueueNum').innerText = inv.turnNumber || ('A-' + (inv.queueNumber || 1));
    if (document.getElementById('pCustomer')) document.getElementById('pCustomer').innerText = inv.customerName || '';
    if (document.getElementById('pDriver')) document.getElementById('pDriver').innerText = inv.carNumber || '---';
    if (document.getElementById('pPayment')) document.getElementById('pPayment').innerText = inv.paymentStatus || '';

    const container = document.getElementById('pItemsTableContainer');
    if (container && inv.items) {
        container.innerHTML = '';
        if (inv.items.length >= 2) {
            container.innerHTML = `
                <tr>
                    <td class="bg-gray bold text-center" style="width: 50%;">البضاعة 2</td>
                    <td class="bg-gray bold text-center" style="width: 50%;">البضاعة 1</td>
                </tr>
                <tr>
                    <td class="text-center" style="width: 50%; border-left: 1px solid #000;">${inv.items[1].name}</td>
                    <td class="text-center" style="width: 50%;">${inv.items[0].name}</td>
                </tr>
                <tr>
                    <td class="bg-gray bold text-center" style="border-left: 1px solid #000;">كمية 2</td>
                    <td class="bg-gray bold text-center">كمية 1</td>
                </tr>
                <tr>
                    <td class="bold text-center" style="border-left: 1px solid #000;">${inv.items[1].qty} متر</td>
                    <td class="bold text-center">${inv.items[0].qty} متر</td>
                </tr>
              `;
        } else if (inv.items.length === 1) {
            container.innerHTML = `
                <tr>
                    <td class="bg-gray bold text-center" style="width: 50%;">البضاعة</td>
                    <td class="text-center" style="width: 50%;">${inv.items[0].name}</td>
                </tr>
                <tr>
                    <td class="bg-gray bold text-center">الكمية</td>
                    <td class="bold text-center">${inv.items[0].qty} متر</td>
                </tr>
            `;
        }
    }

    setTimeout(() => {
        window.focus();
        window.print();
    }, 300);
}

// معالجة وحفظ دفعات الديون المحصلة
document.addEventListener("DOMContentLoaded", () => {
    const repaidDateEl = document.getElementById('repaidDate');
    if (repaidDateEl) {
        repaidDateEl.value = new Date().toLocaleDateString('en-CA');
    }

    renderRecentReceipts();
    loadExpensesTable();
    updateOfflineSyncIndicator();
    if (navigator.onLine) {
        syncOfflineQueueToFirestore(false);
    }

    const btnSaveRepayment = document.getElementById('btnSaveRepayment');
    if (btnSaveRepayment) {
        btnSaveRepayment.addEventListener('click', function() {
            const customerNameInput = document.getElementById('repaidCustomerName');
            const amountInput = document.getElementById('repaidAmount');
            const dateInputEl = document.getElementById('repaidDate');

            const customerName = customerNameInput ? customerNameInput.value.trim() : '';
            const amount = amountInput ? parseFloat(amountInput.value) || 0 : 0;
            const dateInput = dateInputEl ? dateInputEl.value : '';
            const todayIso = new Date().toLocaleDateString('en-CA');

            if (!customerName || amount <= 0) {
                alert("يرجى إدخال اسم الزبون والمبلغ المحصل بشكل صحيح!");
                return;
            }

            const currentQuarry = localStorage.getItem('savedQuarryName') || '';
            const localRepId = 'rep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

            const repaymentData = {
                localId: localRepId,
                customerName: customerName,
                amount: amount,
                date: dateInput || todayIso,
                timestamp: Date.now(),
                quarryName: currentQuarry
            };

            enqueueOfflineAction('repayment', 'repayments', repaymentData, localRepId);
            alert(navigator.onLine
                ? "تم تسجيل دفعة الدين بنجاح وخصمها من الحساب وتحديث الصندوق!"
                : "تم حفظ دفعة الدين محلياً (أوفلاين) وتحديث الرصيد والصندوق، وسيتم إرسالها للمشرف عند عودة الإنترنت.");

            if (customerNameInput) customerNameInput.value = '';
            if (amountInput) amountInput.value = '';
            if (dateInputEl) dateInputEl.value = new Date().toLocaleDateString('en-CA');

            loadDebtsTable();
            calculateCashflow();

            if (navigator.onLine) {
                repaymentsCollection.doc(localRepId).set(repaymentData, { merge: true })
                    .then(() => {
                        const updatedQueue = getOfflineQueue().filter(q => q.queueId !== localRepId);
                        saveOfflineQueue(updatedQueue);
                        loadDebtsTable();
                        calculateCashflow();
                    })
                    .catch((error) => {
                        console.warn("الدفعة محفوظة محلياً وستُزامن لاحقاً:", error);
                    });
            }
        });
    }
});

// حفظ المصاريف / الواردات وتحديث الجدول والصندوق
window.saveExpenseData = function() {
    const noteInput = document.getElementById('expenseNote') || document.querySelector('#tabExpenses input[type="text"]');
    const amountInput = document.getElementById('expenseAmount') || document.querySelector('#tabExpenses input[type="number"]');

    const note = noteInput ? noteInput.value.trim() : '';
    const amount = amountInput ? parseFloat(amountInput.value) || 0 : 0;
    const todayIso = new Date().toLocaleDateString('en-CA');
    const todayAr = new Date().toLocaleDateString('ar-SY');
    const currentTime = new Date().toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });

    if (!note || amount <= 0) {
        alert("يرجى إدخال بيان المصروف والمبلغ بشكل صحيح!");
        return;
    }

    const currentQuarryName = localStorage.getItem('savedQuarryName') || 'مقلع غير مسمى';
    const localExpId = 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    const expenseData = {
        localId: localExpId,
        note: note,
        amount: amount,
        quarryName: currentQuarryName,
        date: todayAr,
        isoDate: todayIso,
        time: currentTime,
        timestamp: Date.now()
    };

    enqueueOfflineAction('expense', 'expenses', expenseData, localExpId);
    alert(navigator.onLine
        ? "تم حفظ المصروف بنجاح وتحديث الصندوق!"
        : "تم حفظ المصروف محلياً (أوفلاين) وتحديث الصندوق، وسيُرسل للمشرف عند عودة الإنترنت.");

    if (noteInput) noteInput.value = '';
    if (amountInput) amountInput.value = '';

    loadExpensesTable();
    calculateCashflow();

    if (navigator.onLine) {
        expensesCollection.doc(localExpId).set(expenseData, { merge: true })
            .then(() => {
                const updatedQueue = getOfflineQueue().filter(q => q.queueId !== localExpId);
                saveOfflineQueue(updatedQueue);
                loadExpensesTable();
                calculateCashflow();
            })
            .catch((error) => {
                console.warn("المصروف محفوظ محلياً وسيُزامن لاحقاً:", error);
            });
    }
};

// دالة تحميل وعرض جدول المصاريف والسجل التفصيلي
function loadExpensesTable() {
    const expensesContainer = document.getElementById('expensesListTable');
    if (!expensesContainer) return;

    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    expensesCollection.where('quarryName', '==', currentQuarry).get().then((querySnapshot) => {
        let expensesList = [];
        const cloudIds = new Set();

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            cloudIds.add(doc.id);
            if (data.localId) cloudIds.add(data.localId);
            expensesList.push({ id: doc.id, ...data });
        });

        const pendingExpenses = getPendingItemsByType('expense', currentQuarry);
        pendingExpenses.forEach(exp => {
            if (!cloudIds.has(exp._localId)) {
                expensesList.push({ id: exp._localId, ...exp });
            }
        });

        expensesList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (expensesList.length === 0) {
            expensesContainer.innerHTML = "<p style='padding:10px; color:#666; font-size:13px;'>لا توجد مصاريف أو واردات مسجلة حتى الآن.</p>";
            return;
        }

        let tableHTML = `
            <table class="items-table" style="width:100%; border-collapse: collapse; background:#fff;">
                <thead>
                    <tr style="background:#eaf2f8;">
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">التاريخ والوقت</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">بيان المصروف (أجور عمال، وقود، صيانة...)</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">المبلغ ($)</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:center;">إجراء</th>
                    </tr>
                </thead>
                <tbody>
        `;

        expensesList.forEach((exp) => {
            let dateTimeStr = `${exp.date || '---'} ${exp.time ? '(' + exp.time + ')' : ''}`;
            const pendingTag = exp._isOfflinePending ? ` <span style="background:#f39c12; color:#fff; font-size:10px; padding:1px 6px; border-radius:3px;">بانتظار الإرسال</span>` : '';
            tableHTML += `
                <tr>
                    <td style="padding:10px; border:1px solid #ddd; font-size:13px;">${dateTimeStr}</td>
                    <td style="padding:10px; border:1px solid #ddd;"><b>${exp.note || '---'}</b>${pendingTag}</td>
                    <td style="padding:10px; border:1px solid #ddd; font-weight:bold; color:#c0392b;">$${Number(exp.amount || 0).toFixed(2)}</td>
                    <td style="padding:10px; border:1px solid #ddd; text-align:center;">
                        <button type="button" onclick="deleteExpense('${exp.id}')" style="background:#e74c3c; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px;">حذف X</button>
                    </td>
                </tr>
            `;
        });

        tableHTML += `</tbody></table>`;
        expensesContainer.innerHTML = tableHTML;
    }).catch((error) => {
        console.error("خطأ في جلب بيانات المصاريف: ", error);
    });
}

// دالة حذف مصروف معين من جدول السجل والطابور/السحابة
window.deleteExpense = function(id) {
    if (!id) return;
    if (confirm("هل أنت متأكد من حذف هذا السجل نهائياً؟")) {
        const filteredQueue = getOfflineQueue().filter(q => q.queueId !== id);
        if (filteredQueue.length !== getOfflineQueue().length) {
            saveOfflineQueue(filteredQueue);
            loadExpensesTable();
            calculateCashflow();
            return;
        }
        expensesCollection.doc(id).delete().then(() => {
            alert("تم حذف المصروف بنجاح!");
            loadExpensesTable();
            calculateCashflow();
        }).catch((error) => {
            console.error("خطأ في حذف المصروف: ", error);
        });
    }
};

// دالة البحث والفلترة في جدول المصاريف
window.filterExpenses = function() {
    let input = document.getElementById('searchExpenseNote').value.toLowerCase();
    let rows = document.querySelectorAll('#expensesListTable tbody tr');
    rows.forEach(row => {
        let noteText = row.cells[1] ? row.cells[1].textContent.toLowerCase() : '';
        if (noteText.includes(input)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
};

// مسح سجل المواد الظاهرة لزبون معين يدوياً من قبل المحاسب
window.clearCustomerDebtMaterials = function(customerName) {
    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    const storageKey = `clearedDebtMaterials_${currentQuarry}`;
    let clearedList = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!clearedList.includes(customerName)) {
        clearedList.push(customerName);
        localStorage.setItem(storageKey, JSON.stringify(clearedList));
    }
    loadDebtsTable();
};

// ==========================================
// تعديل اسم الزبون في كافة الفواتير والدفعات المرتبطة به
// ==========================================
window.renameCustomerName = async function(oldName) {
    const cleanOld = (oldName || '').trim();
    if (!cleanOld) return;

    const inputNew = prompt(`تعديل اسم الزبون من "${cleanOld}" إلى الاسم الصحيح:`, cleanOld);
    if (inputNew === null) return;

    const cleanNew = inputNew.trim();
    if (!cleanNew) {
        alert("يرجى إدخال اسم صحيح للزبون!");
        return;
    }
    if (cleanNew === cleanOld) return;

    const currentQuarry = localStorage.getItem('savedQuarryName') || '';

    try {
        let queue = typeof getOfflineQueue === 'function' ? getOfflineQueue() : [];
        let queueChanged = false;

        queue = queue.map(item => {
            if (!item || !item.payload) return item;
            const sameQuarry = !currentQuarry || !item.payload.quarryName || item.payload.quarryName === currentQuarry;
            if (sameQuarry && (item.payload.customerName || '').trim() === cleanOld) {
                queueChanged = true;
                return Object.assign({}, item, {
                    payload: Object.assign({}, item.payload, { customerName: cleanNew })
                });
            }
            return item;
        });

        if (queueChanged && typeof saveOfflineQueue === 'function') {
            saveOfflineQueue(queue);
        }

        if (currentQuarry) {
            const clearedKey = `clearedDebtMaterials_${currentQuarry}`;
            let clearedList = JSON.parse(localStorage.getItem(clearedKey) || '[]');
            if (clearedList.includes(cleanOld)) {
                clearedList = clearedList.filter(c => c !== cleanOld);
                if (!clearedList.includes(cleanNew)) clearedList.push(cleanNew);
                localStorage.setItem(clearedKey, JSON.stringify(clearedList));
            }
        }

        const invQuery = currentQuarry
            ? invoicesCollection.where('quarryName', '==', currentQuarry)
            : invoicesCollection;
        const repQuery = currentQuarry
            ? repaymentsCollection.where('quarryName', '==', currentQuarry)
            : repaymentsCollection;

        const [invSnap, repSnap] = await Promise.all([invQuery.get(), repQuery.get()]);
        const batch = db.batch();
        let batchOps = 0;

        invSnap.forEach(doc => {
            const data = doc.data();
            if ((data.customerName || '').trim() === cleanOld) {
                batch.update(doc.ref, { customerName: cleanNew });
                batchOps++;
            }
        });

        repSnap.forEach(doc => {
            const data = doc.data();
            if ((data.customerName || '').trim() === cleanOld) {
                batch.update(doc.ref, { customerName: cleanNew });
                batchOps++;
            }
        });

        if (batchOps > 0) {
            await batch.commit();
        }

        alert(`تم تعديل الاسم من "${cleanOld}" إلى "${cleanNew}" بنجاح مع الحفاظ على كافة الفواتير والدفعات والمواد.`);
        if (typeof loadDebtsTable === 'function') loadDebtsTable();
        if (typeof loadInvoices === 'function') loadInvoices();
        if (typeof calculateCashflow === 'function') calculateCashflow();
    } catch (err) {
        console.error("خطأ أثناء تعديل اسم الزبون:", err);
        alert("حدث خطأ أثناء تحديث الاسم. تأكد من الاتصال أو جرّب مرة أخرى.");
    }
};

// ==========================================
// كشف حساب تفصيلي (شبيه بالإكسل) لكل زبون مدين
// ==========================================
window.openCustomerLedgerModal = function(customerName) {
    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!customerName) return;

    Promise.all([
        invoicesCollection.where('quarryName', '==', currentQuarry).get(),
        repaymentsCollection.where('quarryName', '==', currentQuarry).get()
    ]).then(([invSnap, repSnap]) => {
        const movements = [];
        const seenInv = new Set();
        const seenRep = new Set();
        const targetCust = customerName.trim();

        const pushInvoiceMovements = (inv) => {
            if (inv.paymentStatus !== 'دين') return;
            if ((inv.customerName || '').trim() !== targetCust) return;

            const ts = inv.timestamp || new Date(inv.isoDate || Date.now()).getTime() || Date.now();
            const dateLabel = inv.date || inv.isoDate || '---';
            const turnLabel = inv.turnNumber ? `دور #${inv.turnNumber}` : 'فاتورة دين';

            if (Array.isArray(inv.items) && inv.items.length > 0) {
                const totalItemsAmount = inv.items.reduce((acc, it) => acc + (Number(it.total) || 0), 0);
                const fallbackTotal = Number(inv.grandTotal || 0);

                inv.items.forEach((it, idx) => {
                    const matName = (it.name || 'مادة عامة').trim();
                    const qty = Number(it.qty || 0);
                    const price = Number(it.price || 0);
                    const itemAmount = totalItemsAmount > 0
                        ? (Number(it.total) || 0)
                        : (idx === 0 ? fallbackTotal : 0);

                    movements.push({
                        sortKey: ts + idx,
                        date: dateLabel,
                        operation: `${turnLabel} (سيارة: ${inv.carNumber || '---'})`,
                        materialName: matName,
                        qty: qty,
                        unitPrice: price,
                        debitAdd: itemAmount,
                        creditPaid: 0
                    });
                });
            } else {
                movements.push({
                    sortKey: ts,
                    date: dateLabel,
                    operation: `${turnLabel} (سيارة: ${inv.carNumber || '---'})`,
                    materialName: 'مواد عامة',
                    qty: 0,
                    unitPrice: 0,
                    debitAdd: Number(inv.grandTotal || 0),
                    creditPaid: 0
                });
            }
        };

        invSnap.forEach(doc => {
            const inv = doc.data();
            seenInv.add(doc.id);
            if (inv.localId) seenInv.add(inv.localId);
            pushInvoiceMovements(inv);
        });

        getPendingItemsByType('invoice', currentQuarry).forEach(inv => {
            if (!seenInv.has(inv._localId)) {
                pushInvoiceMovements(inv);
            }
        });

        const pushRepaymentMovement = (rep) => {
            if ((rep.customerName || '').trim() !== targetCust) return;
            const ts = rep.timestamp || new Date(rep.date || Date.now()).getTime() || Date.now();
            movements.push({
                sortKey: ts,
                date: rep.date || '---',
                operation: 'دفعة محصلة من الدين',
                materialName: '--- (دفعة نقدية)',
                qty: 0,
                unitPrice: 0,
                debitAdd: 0,
                creditPaid: Number(rep.amount || 0)
            });
        };

        repSnap.forEach(doc => {
            const rep = doc.data();
            seenRep.add(doc.id);
            if (rep.localId) seenRep.add(rep.localId);
            pushRepaymentMovement(rep);
        });

        getPendingItemsByType('repayment', currentQuarry).forEach(rep => {
            if (!seenRep.has(rep._localId)) {
                pushRepaymentMovement(rep);
            }
        });

        movements.sort((a, b) => a.sortKey - b.sortKey);

        let runningBalance = 0;
        let totalQtyAll = 0;
        let totalDebitAll = 0;
        let totalPaidAll = 0;

        let rowsHtml = '';
        movements.forEach((m, index) => {
            runningBalance += (m.debitAdd - m.creditPaid);
            totalQtyAll += m.qty;
            totalDebitAll += m.debitAdd;
            totalPaidAll += m.creditPaid;

            const isPayment = m.creditPaid > 0 && m.debitAdd === 0;
            const rowBg = isPayment ? '#eafaf1' : (index % 2 === 0 ? '#ffffff' : '#fafafa');
            const qtyText = m.qty > 0 ? `${m.qty.toFixed(2)} م3` : '---';
            const priceText = m.unitPrice > 0 ? `$${m.unitPrice.toFixed(2)}` : '---';
            const debitText = m.debitAdd > 0 ? `$${m.debitAdd.toFixed(2)}` : '---';
            const paidText = m.creditPaid > 0 ? `$${m.creditPaid.toFixed(2)}` : '---';

            rowsHtml += `
                <tr style="background:${rowBg};">
                    <td style="padding:8px; border:1px solid #ccc; text-align:center;">${index + 1}</td>
                    <td style="padding:8px; border:1px solid #ccc; text-align:center;">${m.date}</td>
                    <td style="padding:8px; border:1px solid #ccc;">${m.operation}</td>
                    <td style="padding:8px; border:1px solid #ccc;"><b>${m.materialName}</b></td>
                    <td style="padding:8px; border:1px solid #ccc; text-align:center; color:#2980b9;"><b>${qtyText}</b></td>
                    <td style="padding:8px; border:1px solid #ccc; text-align:center;">${priceText}</td>
                    <td style="padding:8px; border:1px solid #ccc; text-align:center; color:#c0392b; font-weight:bold;">${debitText}</td>
                    <td style="padding:8px; border:1px solid #ccc; text-align:center; color:#27ae60; font-weight:bold;">${paidText}</td>
                    <td style="padding:8px; border:1px solid #ccc; text-align:center; font-weight:bold; color:#2c3e50;">$${runningBalance.toFixed(2)}</td>
                </tr>
            `;
        });

        if (!rowsHtml) {
            rowsHtml = `<tr><td colspan="9" style="padding:14px; text-align:center; color:#666;">لا توجد حركات مسجلة لهذا الزبون.</td></tr>`;
        }

        let modal = document.getElementById('customerLedgerModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'customerLedgerModal';
            modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:10000; display:flex; align-items:center; justify-content:center; padding:16px;';
            document.body.appendChild(modal);
        }

        modal.style.display = 'flex';
        modal.innerHTML = `
            <div style="background:#fff; width:100%; max-width:1050px; max-height:90vh; overflow:auto; border-radius:8px; padding:18px; box-shadow:0 8px 28px rgba(0,0,0,0.3); direction:rtl;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #8B5A2B; padding-bottom:10px; margin-bottom:14px;">
                    <div>
                        <h3 style="margin:0; color:#2c3e50;">📊 كشف حساب الزبون التفصيلي: <span style="color:#8B5A2B;">${targetCust}</span></h3>
                        <small style="color:#666;">المقلع: ${currentQuarry || 'غير محدد'} — سجل تفصيلي بالمواد والكميات والدفعات والرصيد المتبقي</small>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" onclick="window.print()" style="background:#2980b9; color:#fff; border:none; padding:6px 12px; border-radius:5px; cursor:pointer; font-size:13px;">🖨️ طباعة الكشف</button>
                        <button type="button" onclick="document.getElementById('customerLedgerModal').style.display='none'" style="background:#e74c3c; color:#fff; border:none; padding:6px 12px; border-radius:5px; cursor:pointer; font-size:13px;">إغلاق ✖</button>
                    </div>
                </div>

                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:13px;">
                        <thead>
                            <tr style="background:#8B5A2B; color:#fff;">
                                <th style="padding:9px; border:1px solid #ccc; width:45px;">#</th>
                                <th style="padding:9px; border:1px solid #ccc;">التاريخ</th>
                                <th style="padding:9px; border:1px solid #ccc;">البيان / الحركة</th>
                                <th style="padding:9px; border:1px solid #ccc;">المادة</th>
                                <th style="padding:9px; border:1px solid #ccc;">الكمية</th>
                                <th style="padding:9px; border:1px solid #ccc;">سعر المتر</th>
                                <th style="padding:9px; border:1px solid #ccc;">دين مضاف ($)</th>
                                <th style="padding:9px; border:1px solid #ccc;">مدفوع ($)</th>
                                <th style="padding:9px; border:1px solid #ccc;">المتبقي ($)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                            <tr style="background:#f2f4f4; font-weight:bold; font-size:14px;">
                                <td colspan="4" style="padding:10px; border:1px solid #ccc; text-align:right;">الإجمالي العام للزبون:</td>
                                <td style="padding:10px; border:1px solid #ccc; text-align:center; color:#2980b9;">${totalQtyAll.toFixed(2)} م3</td>
                                <td style="padding:10px; border:1px solid #ccc; text-align:center;">---</td>
                                <td style="padding:10px; border:1px solid #ccc; text-align:center; color:#c0392b;">$${totalDebitAll.toFixed(2)}</td>
                                <td style="padding:10px; border:1px solid #ccc; text-align:center; color:#27ae60;">$${totalPaidAll.toFixed(2)}</td>
                                <td style="padding:10px; border:1px solid #ccc; text-align:center; color:#c0392b;">$${runningBalance.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).catch(err => {
        console.error("خطأ في تحميل كشف حساب الزبون:", err);
        alert("تعذر فتح كشف حساب الزبون حالياً.");
    });
};

// ==========================================
// تصنيف الزبائن كـ خانات متجاورة تفتح عند الاختيار فقط + قائمة اقتراحات فورية
// ==========================================
function buildCustomerAutocompleteList(inputEl, customerNames, onSelectCallback) {
    if (!inputEl) return;

    let listId = inputEl.id + '_autocomplete_box';
    let box = document.getElementById(listId);
    if (!box) {
        box = document.createElement('div');
        box.id = listId;
        box.style.cssText = 'position:absolute; top:100%; right:0; left:0; background:#fff; border:1px solid #8B5A2B; border-radius:0 0 6px 6px; max-height:190px; overflow-y:auto; z-index:999; box-shadow:0 6px 16px rgba(0,0,0,0.15); display:none;';
        if (inputEl.parentElement) {
            inputEl.parentElement.style.position = 'relative';
            inputEl.parentElement.appendChild(box);
        }
    }

    const renderMatches = () => {
        const query = (inputEl.value || '').trim().toLowerCase();
        const matches = customerNames.filter(name => !query || name.toLowerCase().includes(query));

        if (matches.length === 0) {
            box.style.display = 'none';
            return;
        }

        box.innerHTML = matches.map(name => {
            const safeName = name.replace(/'/g, "\\'");
            return `<div onclick="window.__pickCustomerSuggestion('${inputEl.id}', '${safeName}')" style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f0f0f0; font-size:13px; text-align:right; color:#2c3e50;" onmouseover="this.style.background='#fdf5e6'" onmouseout="this.style.background='#fff'">${name}</div>`;
        }).join('');
        box.style.display = 'block';
    };

    window.__pickCustomerSuggestion = window.__pickCustomerSuggestion || function(targetInputId, chosenName) {
        const targetInput = document.getElementById(targetInputId);
        const dropdownBox = document.getElementById(targetInputId + '_autocomplete_box');
        if (targetInput) {
            targetInput.value = chosenName;
            targetInput.dispatchEvent(new Event('input'));
        }
        if (dropdownBox) dropdownBox.style.display = 'none';
        if (typeof onSelectCallback === 'function') onSelectCallback(chosenName);
    };

    inputEl.removeEventListener('focus', renderMatches);
    inputEl.removeEventListener('input', renderMatches);
    inputEl.addEventListener('focus', renderMatches);
    inputEl.addEventListener('input', renderMatches);

    document.addEventListener('click', (e) => {
        if (e.target !== inputEl && !box.contains(e.target)) {
            box.style.display = 'none';
        }
    });
}

window.toggleDebtSubTab = function(tabType) {
    activeDebtSubTab = (activeDebtSubTab === tabType) ? null : tabType;
    updateDebtSubTabUI();
};

function updateDebtSubTabUI() {
    const btnApproved = document.getElementById('btnSelectApprovedDebts');
    const btnNew = document.getElementById('btnSelectNewDebts');
    const panelApproved = document.getElementById('panelApprovedDebts');
    const panelNew = document.getElementById('panelNewDebts');

    if (btnApproved) {
        const isSelected = activeDebtSubTab === 'approved';
        btnApproved.style.background = isSelected ? '#27ae60' : '#f4fbf7';
        btnApproved.style.color = isSelected ? '#fff' : '#1e8449';
        btnApproved.style.borderColor = '#27ae60';
        btnApproved.style.boxShadow = isSelected ? '0 4px 12px rgba(39,174,96,0.28)' : 'none';
    }

    if (btnNew) {
        const isSelected = activeDebtSubTab === 'new';
        btnNew.style.background = isSelected ? '#2980b9' : '#f2f8fc';
        btnNew.style.color = isSelected ? '#fff' : '#1f618d';
        btnNew.style.borderColor = '#2980b9';
        btnNew.style.boxShadow = isSelected ? '0 4px 12px rgba(41,128,185,0.28)' : 'none';
    }

    if (panelApproved) panelApproved.style.display = (activeDebtSubTab === 'approved') ? 'block' : 'none';
    if (panelNew) panelNew.style.display = (activeDebtSubTab === 'new') ? 'block' : 'none';
}

function buildDebtPanelContent(panelId, title, listItems, clearedCustomers) {
    if (!listItems || listItems.length === 0) {
        return `
            <div id="${panelId}" style="display:none; background:#fff; border:1px solid #ddd; border-radius:8px; padding:14px; margin-top:12px;">
                <h4 style="margin:0 0 8px 0; color:#2c3e50;">${title}</h4>
                <p style="margin:0; color:#777; font-size:13px;">لا يوجد زبائن في هذه الخانة حالياً.</p>
            </div>
        `;
    }

    let rowsHtml = '';
    listItems.forEach(item => {
        const cust = item.name;
        const remainingDebt = item.remainingDebt;
        const safeCustBtn = cust.replace(/'/g, "\\'");

        let materialsInner = '<span style="color:#888;">لا توجد مواد مفصلة</span>';
        if (!clearedCustomers.includes(cust) && Array.isArray(item.entries) && item.entries.length > 0) {
            const matRows = item.entries.map(en => `
                <tr>
                    <td style="padding:4px 8px; border:1px solid #e5e5e5; font-size:12px;">${en.matName}</td>
                    <td style="padding:4px 8px; border:1px solid #e5e5e5; font-size:12px; color:#2980b9; font-weight:bold; text-align:center;">${en.qty.toFixed(2)} م3</td>
                    <td style="padding:4px 8px; border:1px solid #e5e5e5; font-size:12px; color:#2c3e50; text-align:center;">${en.date}</td>
                </tr>
            `).join('');

            materialsInner = `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <table style="width:100%; border-collapse:collapse; background:#fafafa;">
                        <thead>
                            <tr style="background:#eef2f5;">
                                <th style="padding:4px 8px; border:1px solid #e5e5e5; font-size:11px; text-align:right;">المادة</th>
                                <th style="padding:4px 8px; border:1px solid #e5e5e5; font-size:11px; text-align:center;">الكمية</th>
                                <th style="padding:4px 8px; border:1px solid #e5e5e5; font-size:11px; text-align:center;">التاريخ</th>
                            </tr>
                        </thead>
                        <tbody>${matRows}</tbody>
                    </table>
                    <div style="text-align:left;">
                        <button type="button" onclick="clearCustomerDebtMaterials('${safeCustBtn}')" title="إخفاء سجل المواد لهذا الزبون" style="background:#e67e22; color:white; border:none; padding:2px 8px; border-radius:3px; cursor:pointer; font-size:11px;">حذف المواد</button>
                    </div>
                </div>
            `;
        }

        rowsHtml += `
            <tr data-customer-name="${cust.toLowerCase()}">
                <td style="padding:10px; border:1px solid #ddd; vertical-align:top;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                        <button type="button" onclick="openCustomerLedgerModal('${safeCustBtn}')" title="فتح كشف الحساب التفصيلي للزبون" style="background:none; border:none; color:#1f618d; text-decoration:underline; font-weight:bold; cursor:pointer; font-size:14px; padding:0;">
                            ${cust} 📊
                        </button>
                        <button type="button" onclick="renameCustomerName('${safeCustBtn}')" title="تعديل اسم الزبون" style="background:#f39c12; color:white; border:none; padding:2px 8px; border-radius:4px; cursor:pointer; font-size:11px; white-space:nowrap;">
                            ✏️ تعديل الاسم
                        </button>
                    </div>
                </td>
                <td style="padding:10px; border:1px solid #ddd; color:#c0392b; font-weight:bold; vertical-align:top;">$${remainingDebt.toFixed(2)}</td>
                <td style="padding:10px; border:1px solid #ddd; vertical-align:top;">${materialsInner}</td>
            </tr>
        `;
    });

    return `
        <div id="${panelId}" style="display:none; background:#fff; border:1px solid #ddd; border-radius:8px; padding:14px; margin-top:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h4 style="margin:0; color:#2c3e50;">${title}</h4>
                <button type="button" onclick="toggleDebtSubTab(null)" style="background:#95a5a6; color:#fff; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px;">إغلاق الخانة ✖</button>
            </div>
            <div style="overflow-x:auto;">
                <table class="items-table" style="width:100%; border-collapse: collapse; background:#fff;">
                    <thead>
                        <tr style="background:#f2f2f2;">
                            <th style="padding:10px; border:1px solid #ddd; text-align:right; width:28%;">اسم الزبون / الشركة</th>
                            <th style="padding:10px; border:1px solid #ddd; text-align:right; width:18%;">إجمالي الدين المتبقي ($)</th>
                            <th style="padding:10px; border:1px solid #ddd; text-align:right; width:54%;">جدول المواد المسحوبة بالدين</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>
    `;
}

function loadDebtsTable() {
    const debtsContainer = document.getElementById('debtsListTable');
    const repaidContainer = document.getElementById('repaidDebtsListTable');
    if (!debtsContainer) return;

    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    const clearedKey = `clearedDebtMaterials_${currentQuarry}`;
    let clearedCustomers = JSON.parse(localStorage.getItem(clearedKey) || '[]');

    Promise.all([
        invoicesCollection.where('quarryName', '==', currentQuarry).get(),
        repaymentsCollection.where('quarryName', '==', currentQuarry).get()
    ]).then(([invSnap, repSnap]) => {

        let customersDebtMap = {};
        let customersEntriesMap = {};
        let customerHistoryCount = {};
        let repaymentsList = [];
        const seenInvIds = new Set();
        const seenRepIds = new Set();

        const recordInvoiceForCustomer = (inv) => {
            if (!inv.customerName) return;
            const name = inv.customerName.trim();
            if (!name) return;

            customerHistoryCount[name] = (customerHistoryCount[name] || 0) + 1;

            if (inv.paymentStatus === 'دين') {
                const amount = Number(inv.grandTotal || 0);
                customersDebtMap[name] = (customersDebtMap[name] || 0) + amount;

                if (!customersEntriesMap[name]) customersEntriesMap[name] = [];
                if (Array.isArray(inv.items)) {
                    inv.items.forEach(item => {
                        customersEntriesMap[name].push({
                            matName: (item.name || 'مادة عامة').trim(),
                            qty: Number(item.qty || 0),
                            date: inv.date || inv.isoDate || '---'
                        });
                    });
                }
            }
        };

        invSnap.forEach(doc => {
            const inv = doc.data();
            seenInvIds.add(doc.id);
            if (inv.localId) seenInvIds.add(inv.localId);
            recordInvoiceForCustomer(inv);
        });

        getPendingItemsByType('invoice', currentQuarry).forEach(inv => {
            if (!seenInvIds.has(inv._localId)) {
                recordInvoiceForCustomer(inv);
            }
        });

        const recordRepaymentForCustomer = (rep, idForRow) => {
            const name = (rep.customerName || '').trim();
            if (!name) return;
            customerHistoryCount[name] = (customerHistoryCount[name] || 0) + 1;
            repaymentsList.push({ id: idForRow, ...rep });
            const amount = Number(rep.amount || 0);
            if (customersDebtMap[name] !== undefined) {
                customersDebtMap[name] -= amount;
            } else {
                customersDebtMap[name] = -amount;
            }
        };

        repSnap.forEach(doc => {
            const rep = doc.data();
            seenRepIds.add(doc.id);
            if (rep.localId) seenRepIds.add(rep.localId);
            recordRepaymentForCustomer(rep, doc.id);
        });

        getPendingItemsByType('repayment', currentQuarry).forEach(rep => {
            if (!seenRepIds.has(rep._localId)) {
                recordRepaymentForCustomer(rep, rep._localId);
            }
        });

        if (repaidContainer) {
            if (repaymentsList.length === 0) {
                repaidContainer.innerHTML = "<p style='color:#666; font-size:13px;'>لا توجد دفعات ديون مسجلة حتى الآن.</p>";
            } else {
                let repHtml = `
                    <table class="items-table" style="width:100%; border-collapse: collapse; background:#fff;">
                        <thead>
                            <tr style="background:#eaf2f8;">
                                <th style="padding:8px; border:1px solid #ddd; text-align:right;">اسم الزبون</th>
                                <th style="padding:8px; border:1px solid #ddd; text-align:right;">المبلغ المحصل ($)</th>
                                <th style="padding:8px; border:1px solid #ddd; text-align:right;">التاريخ</th>
                                <th style="padding:8px; border:1px solid #ddd; text-align:center;">إجراء</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                repaymentsList.slice().reverse().forEach(rep => {
                    const pendingTag = rep._isOfflinePending ? ` <span style="background:#f39c12; color:#fff; font-size:10px; padding:1px 6px; border-radius:3px;">بانتظار الإرسال</span>` : '';
                    repHtml += `
                        <tr>
                            <td style="padding:8px; border:1px solid #ddd;"><b>${rep.customerName}</b>${pendingTag}</td>
                            <td style="padding:8px; border:1px solid #ddd; color:#27ae60; font-weight:bold;">$${Number(rep.amount).toFixed(2)}</td>
                            <td style="padding:8px; border:1px solid #ddd;">${rep.date}</td>
                            <td style="padding:8px; border:1px solid #ddd; text-align:center;">
                                <button type="button" onclick="deleteRepayment('${rep.id}')" style="background:#e74c3c; color:white; border:none; padding:3px 8px; border-radius:3px; cursor:pointer;">حذف X</button>
                            </td>
                        </tr>
                    `;
                });
                repHtml += `</tbody></table>`;
                repaidContainer.innerHTML = repHtml;
            }
        }

        const approvedCustomers = [];
        const newCustomers = [];
        let approvedTotal = 0;
        let newTotal = 0;
        let totalGeneralDebt = 0;
        const allDebtCustomerNames = [];

        for (let cust in customersDebtMap) {
            const remainingDebt = Number(customersDebtMap[cust] || 0);
            if (remainingDebt <= 0) {
                clearedCustomers = clearedCustomers.filter(c => c !== cust);
                localStorage.setItem(clearedKey, JSON.stringify(clearedCustomers));
                continue;
            }

            totalGeneralDebt += remainingDebt;
            allDebtCustomerNames.push(cust);

            const itemObj = {
                name: cust,
                remainingDebt: remainingDebt,
                entries: customersEntriesMap[cust] || []
            };

            if ((customerHistoryCount[cust] || 0) > 1) {
                approvedCustomers.push(itemObj);
                approvedTotal += remainingDebt;
            } else {
                newCustomers.push(itemObj);
                newTotal += remainingDebt;
            }
        }

        const cardsRowHtml = `
            <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:10px;">
                <button type="button" id="btnSelectApprovedDebts" onclick="toggleDebtSubTab('approved')" style="flex:1; min-width:230px; padding:14px 18px; border-radius:8px; border:2px solid #27ae60; background:#f4fbf7; color:#1e8449; cursor:pointer; text-align:right; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s;">
                    <div>
                        <div style="font-size:15px; font-weight:bold;">✅ الزبائن المعتمدون</div>
                        <div style="font-size:12px; opacity:0.85; margin-top:3px;">أصحاب سجل سابق (${approvedCustomers.length}) — اضغط للعرض</div>
                    </div>
                    <span style="font-size:15px; font-weight:bold;">$${approvedTotal.toFixed(2)}</span>
                </button>

                <button type="button" id="btnSelectNewDebts" onclick="toggleDebtSubTab('new')" style="flex:1; min-width:230px; padding:14px 18px; border-radius:8px; border:2px solid #2980b9; background:#f2f8fc; color:#1f618d; cursor:pointer; text-align:right; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s;">
                    <div>
                        <div style="font-size:15px; font-weight:bold;">🆕 الزبائن الجدد</div>
                        <div style="font-size:12px; opacity:0.85; margin-top:3px;">سحب بالدين لأول مرة (${newCustomers.length}) — اضغط للعرض</div>
                    </div>
                    <span style="font-size:15px; font-weight:bold;">$${newTotal.toFixed(2)}</span>
                </button>
            </div>
        `;

        const approvedPanelHtml = buildDebtPanelContent(
            'panelApprovedDebts',
            'الزبائن المعتمدون (أصحاب سجل سابق)',
            approvedCustomers,
            clearedCustomers
        );

        const newPanelHtml = buildDebtPanelContent(
            'panelNewDebts',
            'الزبائن الجدد (سحب بالدين لأول مرة)',
            newCustomers,
            clearedCustomers
        );

        debtsContainer.innerHTML = cardsRowHtml + approvedPanelHtml + newPanelHtml;
        updateDebtSubTabUI();

        const totalGeneralDebtsEl = document.getElementById('totalGeneralDebts');
        if (totalGeneralDebtsEl) {
            totalGeneralDebtsEl.innerText = `${totalGeneralDebt.toFixed(2)} $`;
        }

        buildCustomerAutocompleteList(document.getElementById('searchDebtCustomer'), allDebtCustomerNames, () => {
            window.filterDebts();
        });
        buildCustomerAutocompleteList(document.getElementById('repaidCustomerName'), allDebtCustomerNames);
        window.filterDebts();
    }).catch(err => {
        console.error("خطأ في جلب بيانات الديون: ", err);
    });
}

window.filterDebts = function() {
    const searchEl = document.getElementById('searchDebtCustomer');
    const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const rows = document.querySelectorAll('#debtsListTable tbody tr[data-customer-name]');

    let matchedInApproved = false;
    let matchedInNew = false;

    rows.forEach(row => {
        const custName = (row.getAttribute('data-customer-name') || '').toLowerCase();
        const isMatch = (!query || custName.includes(query));
        row.style.display = isMatch ? '' : 'none';

        if (query && isMatch) {
            if (row.closest('#panelApprovedDebts')) matchedInApproved = true;
            if (row.closest('#panelNewDebts')) matchedInNew = true;
        }
    });

    if (query) {
        if (matchedInApproved) {
            activeDebtSubTab = 'approved';
            updateDebtSubTabUI();
        } else if (matchedInNew) {
            activeDebtSubTab = 'new';
            updateDebtSubTabUI();
        }
    }
};

window.deleteRepayment = function(id) {
    if (confirm("هل تريد حذف هذه الدفعة المحصلة نهائياً؟")) {
        const filteredQueue = getOfflineQueue().filter(q => q.queueId !== id);
        if (filteredQueue.length !== getOfflineQueue().length) {
            saveOfflineQueue(filteredQueue);
            loadDebtsTable();
            calculateCashflow();
            return;
        }
        repaymentsCollection.doc(id).delete().then(() => {
            alert("تم الحذف بنجاح!");
            loadDebtsTable();
            calculateCashflow();
        }).catch(err => console.error("خطأ في الحذف: ", err));
    }
};

function calculateCashflow() {
    const dateFilterEl = document.getElementById('cashDateFilter');
    let selectedDateStr = '';

    if (dateFilterEl && dateFilterEl.value) {
        selectedDateStr = dateFilterEl.value;
    } else {
        selectedDateStr = new Date().toLocaleDateString('en-CA');
    }

    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    Promise.all([
        invoicesCollection.where('quarryName', '==', currentQuarry).get(),
        repaymentsCollection.where('quarryName', '==', currentQuarry).get(),
        expensesCollection.where('quarryName', '==', currentQuarry).get()
    ]).then(([querySnapshot, repSnap, expSnap]) => {
        let totalCashSales = 0;
        let totalNewDebts = 0;
        let totalRepaidDebts = 0;
        let totalExpenses = 0;
        const seenInv = new Set();
        const seenRep = new Set();
        const seenExp = new Set();

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
            seenInv.add(doc.id);
            if (inv.localId) seenInv.add(inv.localId);

            if (inv.isoDate === selectedDateStr || inv.date === selectedDateStr) {
                const amount = Number(inv.grandTotal || 0);
                if (inv.paymentStatus === 'دين') {
                    totalNewDebts += amount;
                } else {
                    totalCashSales += amount;
                }
            }
        });

        getPendingItemsByType('invoice', currentQuarry).forEach((inv) => {
            if (!seenInv.has(inv._localId) && (inv.isoDate === selectedDateStr || inv.date === selectedDateStr)) {
                const amount = Number(inv.grandTotal || 0);
                if (inv.paymentStatus === 'دين') {
                    totalNewDebts += amount;
                } else {
                    totalCashSales += amount;
                }
            }
        });

        repSnap.forEach((doc) => {
            const rep = doc.data();
            seenRep.add(doc.id);
            if (rep.localId) seenRep.add(rep.localId);

            if (rep.date === selectedDateStr) {
                totalRepaidDebts += Number(rep.amount || 0);
            }
        });

        getPendingItemsByType('repayment', currentQuarry).forEach((rep) => {
            if (!seenRep.has(rep._localId) && rep.date === selectedDateStr) {
                totalRepaidDebts += Number(rep.amount || 0);
            }
        });

        expSnap.forEach((doc) => {
            const exp = doc.data();
            seenExp.add(doc.id);
            if (exp.localId) seenExp.add(exp.localId);

            if (exp.isoDate === selectedDateStr || exp.date === selectedDateStr) {
                totalExpenses += Number(exp.amount || 0);
            }
        });

        getPendingItemsByType('expense', currentQuarry).forEach((exp) => {
            if (!seenExp.has(exp._localId) && (exp.isoDate === selectedDateStr || exp.date === selectedDateStr)) {
                totalExpenses += Number(exp.amount || 0);
            }
        });

        const cashSalesValEl = document.getElementById('cashSalesVal');
        const cashRepaidValEl = document.getElementById('cashRepaidVal');
        const cashExpensesValEl = document.getElementById('cashExpensesVal');
        const cashNewDebtsValEl = document.getElementById('cashNewDebtsVal');
        const finalCashBalanceEl = document.getElementById('finalCashBalance');

        if (cashSalesValEl) cashSalesValEl.innerText = `$${totalCashSales.toFixed(2)}`;
        if (cashRepaidValEl) cashRepaidValEl.innerText = `$${totalRepaidDebts.toFixed(2)}`;
        if (cashExpensesValEl) cashExpensesValEl.innerText = `$${totalExpenses.toFixed(2)}`;
        if (cashNewDebtsValEl) cashNewDebtsValEl.innerText = `$${totalNewDebts.toFixed(2)}`;

        let netTotal = totalCashSales + totalRepaidDebts - totalExpenses;
        if (finalCashBalanceEl) {
            finalCashBalanceEl.innerText = `$${netTotal.toFixed(2)}`;
        }
    }).catch((error) => {
        console.error("خطأ في حساب حركة الصندوق: ", error);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const cashDateFilter = document.getElementById('cashDateFilter');
    if (cashDateFilter) {
        cashDateFilter.addEventListener('change', calculateCashflow);
    }
});

// ==========================================
// تعديل الفواتير مباشرة من الأرشيف (الكمية، السعر، حالة الدفع نقداً/دين، الاسم، السائق)
// ==========================================
window.openEditInvoiceModal = function(invoiceId) {
    const inv = latestArchiveInvoicesCache.find(item => String(item.firebaseId) === String(invoiceId) || String(item.localId) === String(invoiceId));
    if (!inv) {
        alert("تعذر العثور على الفاتورة المطلوبة للتعديل.");
        return;
    }

    const itemsList = Array.isArray(inv.items) && inv.items.length > 0
        ? inv.items
        : [{ name: 'مواد عامة', qty: 0, price: 0, total: Number(inv.grandTotal || 0) }];

    const itemsRowsHtml = itemsList.map((it, idx) => {
        const qty = Number(it.qty || 0);
        const price = Number(it.price || 0);
        const lineTotal = (qty * price) || Number(it.total || 0);
        return `
            <tr class="edit-inv-item-row">
                <td style="padding:7px; border:1px solid #ccc;">
                    <input type="text" class="edit-inv-mat-name" value="${(it.name || '').replace(/"/g, '&quot;')}" style="width:100%; padding:5px; border:1px solid #bbb; border-radius:4px;">
                </td>
                <td style="padding:7px; border:1px solid #ccc;">
                    <input type="number" step="any" min="0" class="edit-inv-mat-qty" value="${qty}" oninput="window.__recalcEditInvoiceModalTotal()" style="width:90px; padding:5px; border:1px solid #bbb; border-radius:4px; text-align:center;">
                </td>
                <td style="padding:7px; border:1px solid #ccc;">
                    <input type="number" step="any" min="0" class="edit-inv-mat-price" value="${price}" oninput="window.__recalcEditInvoiceModalTotal()" style="width:90px; padding:5px; border:1px solid #bbb; border-radius:4px; text-align:center;">
                </td>
                <td style="padding:7px; border:1px solid #ccc; text-align:center; font-weight:bold; color:#2c3e50;" class="edit-inv-mat-total">$${lineTotal.toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    let modal = document.getElementById('editInvoiceModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'editInvoiceModal';
        modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.58); z-index:10001; display:flex; align-items:center; justify-content:center; padding:16px;';
        document.body.appendChild(modal);
    }

    const currentStatus = inv.paymentStatus === 'دين' ? 'دين' : 'نقداً';
    const safeDocId = String(inv.firebaseId || inv.localId || '').replace(/'/g, "\\'");

    modal.style.display = 'flex';
    modal.innerHTML = `
        <div style="background:#fff; width:100%; max-width:780px; max-height:90vh; overflow:auto; border-radius:8px; padding:18px; box-shadow:0 8px 28px rgba(0,0,0,0.35); direction:rtl;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #8B5A2B; padding-bottom:10px; margin-bottom:14px;">
                <div>
                    <h3 style="margin:0; color:#2c3e50;">✏️ تعديل فاتورة الأرشيف: <span style="color:#8B5A2B;">${inv.customerName || ''}</span> <small style="color:#666;">(#${inv.turnNumber || inv.queueNumber || ''})</small></h3>
                    <small style="color:#666;">يمكنك تعديل الكمية أو السعر أو تحويل الحالة بين نقداً ودين لتحديث الديون والصندوق تلقائياً</small>
                </div>
                <button type="button" onclick="document.getElementById('editInvoiceModal').style.display='none'" style="background:#e74c3c; color:#fff; border:none; padding:5px 11px; border-radius:4px; cursor:pointer; font-size:13px;">إغلاق ✖</button>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:14px;">
                <div>
                    <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:4px;">اسم الزبون:</label>
                    <input type="text" id="editInvCustomerName" value="${(inv.customerName || '').replace(/"/g, '&quot;')}" style="width:100%; padding:7px; border:1px solid #bbb; border-radius:5px;">
                </div>
                <div>
                    <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:4px;">السائق / السيارة:</label>
                    <input type="text" id="editInvCarNumber" value="${(inv.carNumber || '---').replace(/"/g, '&quot;')}" style="width:100%; padding:7px; border:1px solid #bbb; border-radius:5px;">
                </div>
                <div>
                    <label style="display:block; font-size:12px; font-weight:bold; margin-bottom:4px;">حالة الدفع:</label>
                    <select id="editInvPaymentStatus" style="width:100%; padding:7px; border:1px solid #8B5A2B; border-radius:5px; font-weight:bold; background:#fffdf7;">
                        <option value="نقداً" ${currentStatus === 'نقداً' ? 'selected' : ''}>نقداً</option>
                        <option value="دين" ${currentStatus === 'دين' ? 'selected' : ''}>دين</option>
                    </select>
                </div>
            </div>

            <div style="overflow-x:auto; margin-bottom:14px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <thead>
                        <tr style="background:#8B5A2B; color:#fff;">
                            <th style="padding:8px; border:1px solid #ccc; text-align:right;">المادة</th>
                            <th style="padding:8px; border:1px solid #ccc; text-align:center;">الكمية (م3)</th>
                            <th style="padding:8px; border:1px solid #ccc; text-align:center;">السعر ($)</th>
                            <th style="padding:8px; border:1px solid #ccc; text-align:center;">الإجمالي ($)</th>
                        </tr>
                    </thead>
                    <tbody id="editInvItemsBody">${itemsRowsHtml}</tbody>
                </table>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; background:#f4f6f7; padding:10px 14px; border-radius:6px; margin-bottom:14px;">
                <span style="font-weight:bold; font-size:14px;">الإجمالي الكلي للفاتورة:</span>
                <span id="editInvGrandTotalPreview" style="font-weight:bold; font-size:17px; color:#27ae60;">$${Number(inv.grandTotal || 0).toFixed(2)}</span>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button type="button" onclick="document.getElementById('editInvoiceModal').style.display='none'" style="background:#7f8c8d; color:#fff; border:none; padding:8px 16px; border-radius:5px; cursor:pointer; font-size:13px;">إلغاء</button>
                <button type="button" onclick="window.saveEditedInvoice('${safeDocId}')" style="background:#27ae60; color:#fff; border:none; padding:8px 18px; border-radius:5px; cursor:pointer; font-weight:bold; font-size:13px;">💾 حفظ التعديلات</button>
            </div>
        </div>
    `;

    window.__recalcEditInvoiceModalTotal();
};

window.__recalcEditInvoiceModalTotal = function() {
    let sum = 0;
    document.querySelectorAll('#editInvItemsBody tr.edit-inv-item-row').forEach(row => {
        const q = parseFloat(row.querySelector('.edit-inv-mat-qty')?.value) || 0;
        const p = parseFloat(row.querySelector('.edit-inv-mat-price')?.value) || 0;
        const lineTotal = q * p;
        sum += lineTotal;
        const totalCell = row.querySelector('.edit-inv-mat-total');
        if (totalCell) totalCell.innerText = `$${lineTotal.toFixed(2)}`;
    });
    const grandPreview = document.getElementById('editInvGrandTotalPreview');
    if (grandPreview) grandPreview.innerText = `$${sum.toFixed(2)}`;
};

window.saveEditedInvoice = async function(docOrLocalId) {
    const inv = latestArchiveInvoicesCache.find(item => String(item.firebaseId) === String(docOrLocalId) || String(item.localId) === String(docOrLocalId));
    if (!inv) return;

    const newCustomerName = (document.getElementById('editInvCustomerName')?.value || '').trim();
    const newCarNumber = (document.getElementById('editInvCarNumber')?.value || '---').trim() || '---';
    const newPaymentStatus = document.getElementById('editInvPaymentStatus')?.value === 'دين' ? 'دين' : 'نقداً';

    if (!newCustomerName) {
        alert("يرجى إدخال اسم الزبون!");
        return;
    }

    const updatedItems = [];
    let calculatedGrandTotal = 0;

    document.querySelectorAll('#editInvItemsBody tr.edit-inv-item-row').forEach(row => {
        const matName = (row.querySelector('.edit-inv-mat-name')?.value || 'مادة عامة').trim();
        const qty = parseFloat(row.querySelector('.edit-inv-mat-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.edit-inv-mat-price')?.value) || 0;
        const lineTotal = qty * price;
        calculatedGrandTotal += lineTotal;
        updatedItems.push({
            name: matName,
            qty: qty,
            price: price,
            total: lineTotal
        });
    });

    const targetId = inv.localId || inv.firebaseId;
    const updatedFields = {
        customerName: newCustomerName,
        carNumber: newCarNumber,
        paymentStatus: newPaymentStatus,
        items: updatedItems,
        grandTotal: calculatedGrandTotal,
        updatedAt: Date.now()
    };

    const mergedPayload = Object.assign({}, inv, updatedFields);
    delete mergedPayload.firebaseId;
    delete mergedPayload._localId;
    delete mergedPayload._isOfflinePending;

    // تحديث الطابور المحلي إن وُجد السجل فيه
    const queue = getOfflineQueue();
    const idxInQueue = queue.findIndex(q => q.queueId === targetId || (q.payload && q.payload.localId === targetId));
    if (idxInQueue >= 0) {
        queue[idxInQueue].payload = Object.assign({}, queue[idxInQueue].payload, updatedFields);
        saveOfflineQueue(queue);
    }

    try {
        if (inv.firebaseId && !String(inv.firebaseId).startsWith('inv_')) {
            await invoicesCollection.doc(inv.firebaseId).set(updatedFields, { merge: true });
        } else if (targetId) {
            await invoicesCollection.doc(targetId).set(mergedPayload, { merge: true });
            const filtered = getOfflineQueue().filter(q => q.queueId !== targetId);
            saveOfflineQueue(filtered);
        }
    } catch (err) {
        console.warn("تم حفظ التعديل محلياً وسيُزامن مع Firestore عند توفر الاتصال:", err);
        enqueueOfflineAction('invoice', 'invoices', mergedPayload, targetId);
    }

    const modalEl = document.getElementById('editInvoiceModal');
    if (modalEl) modalEl.style.display = 'none';

    alert("تم حفظ تعديل الفاتورة وتحديث الديون والصندوق بنجاح!");
    loadInvoices();
    loadDebtsTable();
    calculateCashflow();
    loadDailyMaterialsStats();
};

// دالة جلب الأرشيف وترتيبه تصاعدياً مع فلترة حسب مقلع المحاسب الحالي
function loadInvoices() {
    const archiveContainer = document.getElementById('fullArchiveList');
    const myQuarryName = localStorage.getItem('savedQuarryName') || '';

    invoicesCollection.get().then((querySnapshot) => {
        let invoicesList = [];
        const seenIds = new Set();

        querySnapshot.forEach((doc) => {
            const invData = doc.data();
            seenIds.add(doc.id);
            if (invData.localId) seenIds.add(invData.localId);

            if (!myQuarryName || invData.quarryName === myQuarryName) {
                invoicesList.push({ firebaseId: doc.id, ...invData });
            }
        });

        getPendingItemsByType('invoice', myQuarryName).forEach((invData) => {
            if (!seenIds.has(invData._localId)) {
                invoicesList.push({ firebaseId: invData._localId, ...invData });
            }
        });

        if (invoicesList.length === 0) {
            localStorage.setItem('lastQueueNum', '0');
            localStorage.removeItem('lastQueueDate');
        }

        invoicesList.sort((a, b) => {
            let numA = Number(a.queueNumber || (a.turnNumber ? a.turnNumber.replace(/\D/g, '') : 1));
            let numB = Number(b.queueNumber || (b.turnNumber ? b.turnNumber.replace(/\D/g, '') : 1));
            return numA - numB;
        });

        latestArchiveInvoicesCache = invoicesList;
        calculateCashflow();

        if (archiveContainer) {
            let html = `
    <table class="items-table" style="width: 100%; margin-top: 10px; border-collapse: collapse;">
        <thead>
            <tr style="background: #8B5A2B; color: white;">
                <th style="padding: 10px; border: 1px solid #ddd; width: 14%;">المقلع</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 9%;">رقم الدور</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">التاريخ</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 14%;">اسم الزبون</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 9%;">السائق</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 18%;">المواد والكميات</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">الإجمالي ($)</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 9%;">حالة الدفع</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 13%;">إجراء</th>
            </tr>
        </thead>
        <tbody>
`;

            invoicesList.forEach(inv => {
                let itemsSummary = '';
                if (inv.items && Array.isArray(inv.items)) {
                    inv.items.forEach(it => {
                        itemsSummary += `<div>${it.name || ''}: ${it.qty || 0}م3 × $${it.price || 0}</div>`;
                    });
                }
                const pendingBadge = inv._isOfflinePending ? `<div style="font-size:10px; color:#d35400;">⏳ بانتظار المزامنة</div>` : '';
                const safeEditId = String(inv.firebaseId || inv.localId || '').replace(/'/g, "\\'");

                html += `
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>${inv.quarryName || 'غير مسمى'}</b>${pendingBadge}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>#${inv.turnNumber || inv.queueNumber || 1}</b></td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${inv.date || '---'}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>${inv.customerName || '---'}</b></td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${inv.carNumber || '---'}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${itemsSummary}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>$${Number(inv.grandTotal || 0).toFixed(2)}</b></td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center; color:${inv.paymentStatus === 'دين' ? 'red' : 'green'}; font-weight:bold;">${inv.paymentStatus || '---'}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
                            <div style="display:flex; gap:5px; justify-content:center; flex-wrap:wrap;">
                                <button type="button" onclick="openEditInvoiceModal('${safeEditId}')" style="background:#2980b9; color:white; border:none; padding:5px 9px; border-radius:4px; cursor:pointer; font-size:12px;">✏️ تعديل</button>
                                <button type="button" class="btn-del" onclick="deleteInvoice('${safeEditId}')" style="background:#c0392b; color:white; border:none; padding:5px 9px; border-radius:4px; cursor:pointer; font-size:12px;">حذف X</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            archiveContainer.innerHTML = html;
        }
    }).catch((error) => {
        console.error("خطأ في جلب الأرشيف: ", error);
    });
}

window.deleteInvoice = function(firebaseId) {
    if (!firebaseId) return;

    if (confirm("هل أنت متأكد من حذف هذه الفاتورة نهائياً من السحابة؟")) {
        const filteredQueue = getOfflineQueue().filter(q => q.queueId !== firebaseId);
        if (filteredQueue.length !== getOfflineQueue().length) {
            saveOfflineQueue(filteredQueue);
            loadInvoices();
            loadDebtsTable();
            calculateCashflow();
            return;
        }
        db.collection("invoices").doc(firebaseId).delete().then(() => {
            alert("تم الحذف بنجاح!");
            loadInvoices();
            loadDebtsTable();
            calculateCashflow();
        }).catch((error) => {
            console.error("خطأ في الحذف: ", error);
        });
    }
};

// ==========================================
// المراسلة الفورية الحية عبر Firestore بين المقلع والمشرف العام
// ==========================================
let liveMessagesCache = [];
let unsubscribeMessagesListener = null;

function renderChatMessagesFromList(msgs) {
    const box = document.getElementById('chatMessages');
    if (!box) return;

    const myQuarry = (localStorage.getItem('savedQuarryName') || document.getElementById('quarryName')?.value || '').trim();
    box.innerHTML = '';

    const relevantMsgs = msgs.filter(m => {
        if (!myQuarry) return true;
        return m.sender === myQuarry || m.receiver === myQuarry || (m.sender === "المشرف العام" && (!m.receiver || m.receiver === myQuarry || m.receiver === "الكل"));
    });

    if (relevantMsgs.length === 0) {
        box.innerHTML = `<p style="color:#777; font-size:13px; text-align:center;">لا توجد رسائل بعد. ابدأ المراسلة مع المشرف العام.</p>`;
        return;
    }

    relevantMsgs.forEach(m => {
        const isMine = m.sender === myQuarry;
        const safeId = String(m.id || '').replace(/'/g, "\\'");
        box.innerHTML += `
            <div class="chat-msg ${isMine ? 'msg-sender' : 'msg-receiver'}">
                <div>
                    <strong>${m.sender || 'مستخدم'}:</strong> ${m.text || ''}
                    <span style="font-size:10px; color:#666;">${m.time || ''}</span>
                </div>
                <button type="button" class="btn-del-msg" onclick="deleteMessage('${safeId}')">حذف</button>
            </div>
        `;
    });

    box.scrollTop = box.scrollHeight;
}

function updateUnreadBadgeFromList(msgs) {
    const myQuarryName = (localStorage.getItem('savedQuarryName') || document.getElementById('quarryName')?.value || '').trim();
    const badge = document.getElementById('msgBadge');
    if (!badge) return;

    const unreadCount = msgs.filter(m =>
        m.sender === "المشرف العام" &&
        !m.read &&
        (!m.receiver || m.receiver === myQuarryName || m.receiver === "الكل")
    ).length;

    if (unreadCount > 0) {
        badge.innerText = unreadCount;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function listenToFirestoreMessages() {
    if (typeof unsubscribeMessagesListener === 'function') {
        unsubscribeMessagesListener();
    }

    unsubscribeMessagesListener = messagesCollection
        .orderBy('timestamp', 'asc')
        .onSnapshot((snapshot) => {
            const list = [];
            snapshot.forEach(doc => {
                list.push({ id: doc.id, ...doc.data() });
            });
            liveMessagesCache = list;
            renderChatMessagesFromList(liveMessagesCache);
            updateUnreadBadgeFromList(liveMessagesCache);
        }, (err) => {
            console.error("خطأ في الاستماع لرسائل Firestore:", err);
        });
}

document.addEventListener("DOMContentLoaded", () => {
    const sendMsgBtnEl = document.getElementById('btnSendMsg');
    if (sendMsgBtnEl) {
        const clonedBtn = sendMsgBtnEl.cloneNode(true);
        sendMsgBtnEl.parentNode.replaceChild(clonedBtn, sendMsgBtnEl);

        clonedBtn.addEventListener('click', async function() {
            const msgInputEl = document.getElementById('msgInput');
            const text = msgInputEl ? msgInputEl.value.trim() : '';
            const quarry = (localStorage.getItem('savedQuarryName') || document.getElementById('quarryName')?.value || 'مقلع غير مسمى').trim();
            if (!text) return;

            const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const newMsg = {
                id: msgId,
                sender: quarry,
                receiver: "المشرف العام",
                quarryName: quarry,
                text: text,
                read: false,
                time: new Date().toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }),
                timestamp: Date.now()
            };

            if (msgInputEl) msgInputEl.value = '';

            try {
                await messagesCollection.doc(msgId).set(newMsg);
            } catch (err) {
                console.error("فشل إرسال الرسالة إلى Firestore:", err);
                alert("تعذر إرسال الرسالة الآن. تأكد من الاتصال بالإنترنت.");
            }
        });
    }

    listenToFirestoreMessages();
});

window.deleteMessage = async function(id) {
    if (!id) return;
    try {
        await messagesCollection.doc(String(id)).delete();
    } catch (err) {
        console.error("خطأ في حذف الرسالة:", err);
    }
};

function loadChatMessages() {
    renderChatMessagesFromList(liveMessagesCache);
    const myQuarryName = (localStorage.getItem('savedQuarryName') || document.getElementById('quarryName')?.value || '').trim();
    liveMessagesCache.forEach(m => {
        if (m.sender === "المشرف العام" && !m.read && (!m.receiver || m.receiver === myQuarryName || m.receiver === "الكل") && m.id) {
            messagesCollection.doc(String(m.id)).set({ read: true }, { merge: true }).catch(() => {});
        }
    });
}

function resetForm() {
    document.getElementById('customerName').value = '';
    document.getElementById('carNumber').value = '';
    document.getElementById('itemsBody').innerHTML = `
        <tr>
            <td>
                <select class="item-name">
                    <option value="بحص صب">بحص صب</option>
                    <option value="خليط">خليط</option>
                    <option value="رمل صب">رمل صب</option>
                    <option value="زرادة عفاس">زرادة عفاس</option>
                    <option value="زرادة كسارة">زرادة كسارة</option>
                    <option value="نحاته ناعمة">نحاته ناعمة</option>
                    <option value="فرازة">فرازة</option>
                    <option value="كرابية">كرابية</option>
                    <option value="كرابية بلوك">كرابية بلوك</option>
                    <option value="مواد أخرى">مواد أخرى</option>
                </select>
            </td>
            <td><input type="number" class="item-qty" value="" min="0"></td>
            <td><input type="number" class="item-price" value="" min="0"></td>
            <td><input type="text" class="item-total" value="0.00 $" readonly></td>
            <td><button type="button" class="btn-del-row" onclick="removeRow(this)">X</button></td>
        </tr>
    `;
    document.getElementById('grandTotal').innerText = '0.00 $';
    attachEventsToRows();
}

// التشغيل التلقائي عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
    attachEventsToRows();
    loadInvoices();
    loadDebtsTable();
    loadExpensesTable();
    loadDailyMaterialsStats();
});

// دالة تحميل وحساب إحصاء المواد المباعة اليومية حسب التاريخ
function loadDailyMaterialsStats() {
    const dateFilterEl = document.getElementById('dailyMaterialsDateFilter');
    const dailyBody = document.getElementById('dailyMaterialsStatsBody');
    if (!dailyBody) return;

    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    let selectedDateStr = dateFilterEl && dateFilterEl.value ? dateFilterEl.value : new Date().toLocaleDateString('en-CA');

    invoicesCollection.where('quarryName', '==', currentQuarry).get().then((querySnapshot) => {
        let dailyMaterialsMap = {};
        let dayTotalQty = 0;
        let dayTotalMoney = 0;
        const seenIds = new Set();

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
            seenIds.add(doc.id);
            if (inv.localId) seenIds.add(inv.localId);

            if (inv.isoDate === selectedDateStr || inv.date === selectedDateStr) {
                if (inv.items && Array.isArray(inv.items)) {
                    inv.items.forEach(item => {
                        let name = item.name || 'مادة عامة';
                        let qty = Number(item.qty || 0);
                        let total = Number(item.total || 0);

                        if (!dailyMaterialsMap[name]) dailyMaterialsMap[name] = { qty: 0, total: 0 };
                        dailyMaterialsMap[name].qty += qty;
                        dailyMaterialsMap[name].total += total;

                        dayTotalQty += qty;
                        dayTotalMoney += total;
                    });
                }
            }
        });

        getPendingItemsByType('invoice', currentQuarry).forEach((inv) => {
            if (!seenIds.has(inv._localId) && (inv.isoDate === selectedDateStr || inv.date === selectedDateStr)) {
                if (inv.items && Array.isArray(inv.items)) {
                    inv.items.forEach(item => {
                        let name = item.name || 'مادة عامة';
                        let qty = Number(item.qty || 0);
                        let total = Number(item.total || 0);

                        if (!dailyMaterialsMap[name]) dailyMaterialsMap[name] = { qty: 0, total: 0 };
                        dailyMaterialsMap[name].qty += qty;
                        dailyMaterialsMap[name].total += total;

                        dayTotalQty += qty;
                        dayTotalMoney += total;
                    });
                }
            }
        });

        let dailyHtml = '';
        for (let mat in dailyMaterialsMap) {
            dailyHtml += `
                <tr>
                    <td style="padding:8px; border:1px solid #ddd;"><b>${mat}</b></td>
                    <td style="padding:8px; border:1px solid #ddd; color:#2980b9;"><b>${dailyMaterialsMap[mat].qty.toFixed(2)} م3</b></td>
                    <td style="padding:8px; border:1px solid #ddd; color:#27ae60;"><b>${dailyMaterialsMap[mat].total.toFixed(2)} $</b></td>
                </tr>
            `;
        }

        if (dailyHtml === '') {
            dailyHtml = `<tr><td colspan="3" style="text-align:center; padding:12px; color:#666;">لا توجد بيانات مبيعات مسجلة لهذا التاريخ</td></tr>`;
        } else {
            dailyHtml += `
                <tr style="background:#eaf2f8; font-weight:bold;">
                    <td style="padding:10px; border:1px solid #ddd; text-align:right;">الإجمالي اليومي الكلي:</td>
                    <td style="padding:10px; border:1px solid #ddd; color:#c0392b; font-size:15px;">${dayTotalQty.toFixed(2)} م3</td>
                    <td style="padding:10px; border:1px solid #ddd; color:#27ae60; font-size:15px;">${dayTotalMoney.toFixed(2)} $</td>
                </tr>
            `;
        }

        dailyBody.innerHTML = dailyHtml;
    }).catch(error => {
        console.error("خطأ في جلب بيانات إحصاء اليوم:", error);
    });
}

// دالة تحميل وحساب الإحصاء التراكمي الشامل (منذ بدء التشغيل / لكل الفترات)
function loadComprehensiveMaterialsStats() {
    let comprehensiveBody = document.getElementById('comprehensiveMaterialsStatsBody');

    if (!comprehensiveBody) {
        const tables = document.querySelectorAll('table');
        if (tables.length > 0) {
            let compTable = tables[0];
            let tBody = compTable.querySelector('tbody');
            if (!tBody) {
                tBody = document.createElement('tbody');
                tBody.id = 'comprehensiveMaterialsStatsBody';
                compTable.appendChild(tBody);
            }
            comprehensiveBody = tBody;
        }
    }

    if (!comprehensiveBody) return;

    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    invoicesCollection.where('quarryName', '==', currentQuarry).get().then((querySnapshot) => {
        let comprehensiveMap = {};
        let totalQtyAll = 0;
        let totalMoneyAll = 0;
        const seenIds = new Set();

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
            seenIds.add(doc.id);
            if (inv.localId) seenIds.add(inv.localId);

            if (inv.items && Array.isArray(inv.items)) {
                inv.items.forEach(item => {
                    let name = item.name || 'مادة عامة';
                    let qty = Number(item.qty || 0);
                    let total = Number(item.total || 0);

                    if (!comprehensiveMap[name]) comprehensiveMap[name] = { qty: 0, total: 0 };
                    comprehensiveMap[name].qty += qty;
                    comprehensiveMap[name].total += total;

                    totalQtyAll += qty;
                    totalMoneyAll += total;
                });
            }
        });

        getPendingItemsByType('invoice', currentQuarry).forEach((inv) => {
            if (!seenIds.has(inv._localId) && inv.items && Array.isArray(inv.items)) {
                inv.items.forEach(item => {
                    let name = item.name || 'مادة عامة';
                    let qty = Number(item.qty || 0);
                    let total = Number(item.total || 0);

                    if (!comprehensiveMap[name]) comprehensiveMap[name] = { qty: 0, total: 0 };
                    comprehensiveMap[name].qty += qty;
                    comprehensiveMap[name].total += total;

                    totalQtyAll += qty;
                    totalMoneyAll += total;
                });
            }
        });

        let compHtml = '';
        for (let mat in comprehensiveMap) {
            compHtml += `
                <tr>
                    <td style="padding:8px; border:1px solid #ddd;"><b>${mat}</b></td>
                    <td style="padding:8px; border:1px solid #ddd; color:#2980b9;"><b>${comprehensiveMap[mat].qty.toFixed(2)} م3</b></td>
                    <td style="padding:8px; border:1px solid #ddd; color:#27ae60;"><b>${comprehensiveMap[mat].total.toFixed(2)} $</b></td>
                </tr>
            `;
        }

        if (compHtml === '') {
            compHtml = `<tr><td colspan="3" style="text-align:center; padding:12px; color:#666;">لا توجد بيانات مبيعات تراكمية مسجلة بعد</td></tr>`;
        } else {
            compHtml += `
                <tr style="background:#eaf2f8; font-weight:bold;">
                    <td style="padding:10px; border:1px solid #ddd; text-align:right;">الإجمالي التراكمي الشامل:</td>
                    <td style="padding:10px; border:1px solid #ddd; color:#c0392b; font-size:15px;">${totalQtyAll.toFixed(2)} م3</td>
                    <td style="padding:10px; border:1px solid #ddd; color:#27ae60; font-size:15px;">${totalMoneyAll.toFixed(2)} $</td>
                </tr>
            `;
        }

        comprehensiveBody.innerHTML = compHtml;
    }).catch(error => {
        console.error("خطأ في جلب البيانات التراكمية:", error);
    });
}

// دالة تحميل وحساب إحصاء المواد المباعة خلال فترة محددة (من تاريخ إلى تاريخ)
function loadRangeMaterialsStats() {
    const startDateInput = document.getElementById('rangeStartDate').value;
    const endDateInput = document.getElementById('rangeEndDate').value;
    const rangeBody = document.getElementById('rangeMaterialsStatsBody');

    if (!rangeBody) return;

    if (!startDateInput || !endDateInput) {
        alert('الرجاء تحديد تاريخ البداية وتاريخ النهاية معاً!');
        return;
    }

    if (startDateInput > endDateInput) {
        alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساوياً له!');
        return;
    }

    rangeBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px; color:#666;">جاري تحميل وعرض البيانات...</td></tr>`;

    const currentQuarry = localStorage.getItem('savedQuarryName') || '';

    invoicesCollection.get().then((querySnapshot) => {
        let rangeMap = {};
        let totalQtyRange = 0;
        let totalMoneyRange = 0;
        const seenIds = new Set();

        const processInvoiceForRange = (inv) => {
            if (currentQuarry && inv.quarryName && inv.quarryName !== currentQuarry) return;

            let invDate = inv.isoDate || inv.date || inv.invoiceDate || '';
            if (invDate && typeof invDate.toDate === 'function') {
                invDate = invDate.toDate().toISOString().split('T')[0];
            } else if (invDate && typeof invDate === 'string' && invDate.includes('T')) {
                invDate = invDate.split('T')[0];
            }

            if (invDate && invDate >= startDateInput && invDate <= endDateInput) {
                if (inv.items && Array.isArray(inv.items)) {
                    inv.items.forEach(item => {
                        let name = item.name || 'مادة عامة';
                        let qty = Number(item.qty || 0);
                        let total = Number(item.total || 0);

                        if (!rangeMap[name]) rangeMap[name] = { qty: 0, total: 0 };
                        rangeMap[name].qty += qty;
                        rangeMap[name].total += total;

                        totalQtyRange += qty;
                        totalMoneyRange += total;
                    });
                }
            }
        };

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
            seenIds.add(doc.id);
            if (inv.localId) seenIds.add(inv.localId);
            processInvoiceForRange(inv);
        });

        getPendingItemsByType('invoice', currentQuarry).forEach((inv) => {
            if (!seenIds.has(inv._localId)) {
                processInvoiceForRange(inv);
            }
        });

        let rangeHtml = '';
        for (let mat in rangeMap) {
            rangeHtml += `
                <tr>
                    <td style="padding:8px; border:1px solid #ddd;"><b>${mat}</b></td>
                    <td style="padding:8px; border:1px solid #ddd; color:#27ae60;"><b>${rangeMap[mat].qty.toFixed(2)} م3</b></td>
                    <td style="padding:8px; border:1px solid #ddd; color:#2980b9;"><b>${rangeMap[mat].total.toFixed(2)} $</b></td>
                </tr>
            `;
        }

        if (rangeHtml === '') {
            rangeHtml = `<tr><td colspan="3" style="text-align:center; padding:12px; color:#e67e22;"><b>لا توجد مبيعات مسجلة في هذه الفترة المحددة (${startDateInput} إلى ${endDateInput})</b></td></tr>`;
        } else {
            rangeHtml += `
                <tr style="background:#eafaf1; font-weight:bold;">
                    <td style="padding:10px; border:1px solid #ddd; text-align:right;">إجمالي الفترة (${startDateInput} إلى ${endDateInput}):</td>
                    <td style="padding:10px; border:1px solid #ddd; color:#27ae60; font-size:15px;">${totalQtyRange.toFixed(2)} م3</td>
                    <td style="padding:10px; border:1px solid #ddd; color:#2980b9; font-size:15px;">${totalMoneyRange.toFixed(2)} $</td>
                </tr>
            `;
        }

        rangeBody.innerHTML = rangeHtml;
    }).catch(error => {
        console.error("خطأ في جلب بيانات الفترة:", error);
        rangeBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:12px; color:red;">حدث خطأ أثناء جلب البيانات.</td></tr>`;
    });
}

// دالة لضمان تعيين تاريخ اليوم في محدد التاريخ عند فتح تبويب المواد المباعة
const originalSwitchTab = window.switchTab;
window.switchTab = function(tabName) {
    if (typeof originalSwitchTab === 'function') {
        originalSwitchTab(tabName);
    }
    if (tabName === 'materials') {
        const dateInput = document.getElementById('dailyMaterialsDateFilter');
        if (dateInput && !dateInput.value) {
            dateInput.valueAsDate = new Date();
        }
        loadDailyMaterialsStats();
        loadComprehensiveMaterialsStats();
    }
};

// حفظ وتثبيت هوية المقلع الكاملة (محلياً + سحابياً لصفحة المشرف العام)
async function saveQuarryNameSetting() {
    const nameVal = document.getElementById('quarryName').value.trim();
    const addressVal = document.getElementById('quarryAddress').value.trim();
    const phoneVal = document.getElementById('quarryPhone').value.trim();

    if (nameVal === "") {
        alert("الرجاء كتابة اسم المقلع أولاً!");
        return;
    }

    localStorage.setItem('savedQuarryName', nameVal);
    localStorage.setItem('savedQuarryAddress', addressVal || 'غير محدد');
    localStorage.setItem('savedQuarryPhone', phoneVal || 'غير محدد');

    const quarryDocId = encodeURIComponent(nameVal);
    const quarryProfile = {
        quarryName: nameVal,
        address: addressVal || 'غير محدد',
        phone: phoneVal || 'غير محدد',
        updatedAt: Date.now()
    };

    try {
        await quarriesCollection.doc(quarryDocId).set(quarryProfile, { merge: true });
        alert(`تم حفظ وتثبيت هوية (${nameVal}) وإرسالها للمشرف العام بنجاح!`);
    } catch (err) {
        console.warn("تم حفظ الهوية محلياً وسيتم إرسالها عند توفر الاتصال:", err);
        enqueueOfflineAction('quarry', 'quarries', quarryProfile, 'quarry_' + quarryDocId);
        alert(`تم حفظ وتثبيت هوية (${nameVal}) محلياً وسيتم مزامنتها مع المشرف العام!`);
    }

    if (typeof loadInvoices === 'function') loadInvoices();
    if (typeof loadDebtsTable === 'function') loadDebtsTable();
    if (typeof loadExpensesTable === 'function') loadExpensesTable();
    if (typeof listenToFirestoreMessages === 'function') listenToFirestoreMessages();
}

// استرجاع الهوية الكاملة تلقائياً عند فتح الصفحة
document.addEventListener("DOMContentLoaded", () => {
    const savedName = localStorage.getItem('savedQuarryName');
    const savedAddress = localStorage.getItem('savedQuarryAddress');
    const savedPhone = localStorage.getItem('savedQuarryPhone');

    if (savedName && document.getElementById('quarryName')) document.getElementById('quarryName').value = savedName;
    if (savedAddress && document.getElementById('quarryAddress')) document.getElementById('quarryAddress').value = savedAddress;
    if (savedPhone && document.getElementById('quarryPhone')) document.getElementById('quarryPhone').value = savedPhone;
});
// إخفاء شارة المزامنة والنوافذ المنبثقة فقط أثناء الطباعة لمنع سحب ورق إضافي
(function addPrintFixStyle() {
    if (document.getElementById('thermalReceiptPrintFixStyle')) return;
    const style = document.createElement('style');
    style.id = 'thermalReceiptPrintFixStyle';
    style.textContent = `
        @media print {
            #offlineSyncBadge,
            #customerLedgerModal,
            #editInvoiceModal {
                display: none !important;
                visibility: hidden !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('فشل تسجيل Service Worker:', err);
    });
  });
}
