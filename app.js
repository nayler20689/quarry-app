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
let currentEditId = null;

// التبديل بين التبويبات
window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const btns = document.querySelectorAll('.tab-btn');
    if (tabName === 'sales') {
        btns[0].classList.add('active');
        document.getElementById('tabSales').classList.add('active');
    } else if (tabName === 'expenses') {
        btns[1].classList.add('active');
        document.getElementById('tabExpenses').classList.add('active');
        loadExpensesTable(); // تحميل سجل المصاريف عند فتح تبويب المصاريف
    } else if (tabName === 'debts') {
        btns[2].classList.add('active');
        document.getElementById('tabDebts').classList.add('active');
        loadDebtsTable();
    } else if (tabName === 'cashflow') {
        btns[3].classList.add('active');
        document.getElementById('tabCashflow').classList.add('active');
        if(document.getElementById('cashDateFilter')) {
            document.getElementById('cashDateFilter').valueAsDate = new Date();
        }
        calculateCashflow();
    } else if (tabName === 'materials') {
        btns[4].classList.add('active');
        document.getElementById('tabMaterials').classList.add('active');
        loadInvoices();
    } else if (tabName === 'archive') {
        btns[5].classList.add('active');
        document.getElementById('tabArchive').classList.add('active');
        loadInvoices();
    } else if (tabName === 'chat') {
        btns[6].classList.add('active');
        document.getElementById('tabChat').classList.add('active');
        loadChatMessages();
    }
};

// إضافة سطر مادة جديدة
document.getElementById('btnAddRow').addEventListener('click', function() {
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
        if(qty) qty.oninput = calculateGrandTotal;
        if(price) price.oninput = calculateGrandTotal;
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
        if(totalInput) {
            totalInput.value = total.toFixed(2) + ' $';
        }
        totalAll += total;
    });

    const grandTotalEl = document.getElementById('grandTotal');
    if(grandTotalEl) {
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

// حفظ الفاتورة والطباعة الفورية (متوافق مع حماية المتصفح)
document.getElementById('btnSaveAndPrint').addEventListener('click', function() {
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

    // تعريف المتغيرات أولاً
    const currentTurn = generateQueueNumber(); 
    const currentQueueNum = parseInt(localStorage.getItem('lastQueueNum')) || 1;

const quarryName = localStorage.getItem('savedQuarryName') || document.getElementById('quarryName').value.trim() || 'مقلع غير مسمى';
    const quarryAddress = document.getElementById('quarryAddress').value.trim() || localStorage.getItem('savedQuarryAddress') || '---';
    const quarryPhone = document.getElementById('quarryPhone').value.trim() || localStorage.getItem('savedQuarryPhone') || '---';

    const newInvoice = {
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
        grandTotal: numericGrandTotal
    };

    // 1. تشغيل الطباعة والمعاينة فوراً
    printInvoiceData(newInvoice);

    // 2. الحفظ في السحابة والقائمة في الخلفية
    invoicesCollection.add(newInvoice)
    .then(() => {
        console.log("تم حفظ الفاتورة في الأرشيف بنجاح!");
        loadInvoices(); 
        addRecentReceipt(newInvoice);
    })
    .catch((error) => {
        console.error("خطأ في الاتصال بالسحابة: ", error);
        alert("حدث خطأ أثناء الحفظ بالسحابة!");
    });

    resetForm();
});

// إدارة قائمة آخر الإيصالات (تخزين حتى 5، وحذف الأقدم تلقائياً)
function addRecentReceipt(inv) {
    let recent = JSON.parse(localStorage.getItem('recent_receipts') || '[]');
    recent.push(inv);
    if (recent.length > 5) {
        recent.shift(); // حذف أول إيصال (الأقدم) تلقائياً بمجرد تجاوز العدد 5
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

    // عرض الإيصالات من الأحدث إلى الأقدم
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
    if(document.getElementById('pQuarryHeader')) document.getElementById('pQuarryHeader').innerText = inv.quarryName || 'مقلع غير مسمى';
    
    // تحديث العنوان والهاتف في الوصل المطبوع
    if(document.getElementById('pQuarryAddressPhone')) {
        const addr = inv.quarryAddress || localStorage.getItem('savedQuarryAddress') || '---';
        const phn = inv.quarryPhone || localStorage.getItem('savedQuarryPhone') || '---';
        document.getElementById('pQuarryAddressPhone').innerText = `العنوان: ${addr} | هاتف: ${phn}`;
    }

    if(document.getElementById('pDate')) document.getElementById('pDate').innerText = 'التاريخ: ' + (inv.date || '');
    if(document.getElementById('pQueueNum')) document.getElementById('pQueueNum').innerText = inv.turnNumber || ('A-' + (inv.queueNumber || 1));
    if(document.getElementById('pCustomer')) document.getElementById('pCustomer').innerText = inv.customerName || '';
    if(document.getElementById('pDriver')) document.getElementById('pDriver').innerText = inv.carNumber || '---';
    if(document.getElementById('pPayment')) document.getElementById('pPayment').innerText = inv.paymentStatus || '';

    const container = document.getElementById('pItemsTableContainer');
    // ... وباقي الكود القديم يبقى كما هو في الأسفل
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

    // إجبار المتصفح على فتح نافذة الطباعة بسلاسة ودون تعليق
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

    // تحميل آخر الإيصالات المخزنة عند فتح الصفحة
    renderRecentReceipts();
    loadExpensesTable(); // تحميل جدول المصاريف عند البدء

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

            // تعريف اسم المقلع الحالي لضمان العزل
            const currentQuarry = localStorage.getItem('savedQuarryName') || '';

            const repaymentData = {
                customerName: customerName,
                amount: amount,
                date: dateInput || todayIso,
                timestamp: Date.now(),
                quarryName: currentQuarry
            };

            repaymentsCollection.add(repaymentData)
            .then(() => {
                alert("تم تسجيل دفعة الدين بنجاح وخصمها من الحساب وتحديث الصندوق!");
                if(customerNameInput) customerNameInput.value = '';
                if(amountInput) amountInput.value = '';
                if(dateInputEl) dateInputEl.value = new Date().toLocaleDateString('en-CA');
                loadDebtsTable();
                calculateCashflow();
            })
            .catch((error) => {
                console.error("خطأ في حفظ الدفعة: ", error);
                alert("حدث خطأ أثناء حفظ الدفعة بالسحابة!");
            });
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

    // جلب اسم المقلع الحالي المخزن تلقائياً على جهاز المحاسب
    const currentQuarryName = localStorage.getItem('savedQuarryName') || 'مقلع غير مسمى';

    const expenseData = {
        note: note,
        amount: amount,
        quarryName: currentQuarryName, // <-- ربط المصروف باسم المقلع تلقائياً
        date: todayAr,
        isoDate: todayIso,
        time: currentTime,
        timestamp: Date.now()
    };

    expensesCollection.add(expenseData)
    .then(() => {
        alert("تم حفظ المصروف بنجاح وتحديث الصندوق!");
        if (noteInput) noteInput.value = '';
        if (amountInput) amountInput.value = '';
        loadExpensesTable(); // تحديث جدول المصاريف مباشرة
        calculateCashflow();
    })
    .catch((error) => {
        console.error("خطأ في حفظ المصروف: ", error);
        alert("حدث خطأ أثناء حفظ المصروف بالسحابة!");
    });
};

// دالة تحميل وعرض جدول المصاريف والسجل التفصيلي
function loadExpensesTable() {
    const expensesContainer = document.getElementById('expensesListTable');
    if (!expensesContainer) return;

const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    expensesCollection.where('quarryName', '==', currentQuarry).get().then((querySnapshot) => {
    let expensesList = [];
        querySnapshot.forEach((doc) => {
            expensesList.push({ id: doc.id, ...doc.data() });
        });

        // ترتيب المصاريف من الأحدث إلى الأقدم بناءً على الـ timestamp
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
            tableHTML += `
                <tr>
                    <td style="padding:10px; border:1px solid #ddd; font-size:13px;">${dateTimeStr}</td>
                    <td style="padding:10px; border:1px solid #ddd;"><b>${exp.note || '---'}</b></td>
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

// دالة حذف مصروف معين من جدول السجل والسحابة
window.deleteExpense = function(id) {
    if (!id) return;
    if (confirm("هل أنت متأكد من حذف هذا السجل نهائياً؟")) {
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
        let customersMaterialsMap = {};
        let repaymentsList = [];

        invSnap.forEach(doc => {
            const inv = doc.data();
            if (inv.paymentStatus === 'دين' && inv.customerName) {
                let name = inv.customerName.trim();
                let amount = Number(inv.grandTotal || 0);
                customersDebtMap[name] = (customersDebtMap[name] || 0) + amount;

                if (!customersMaterialsMap[name]) {
                    customersMaterialsMap[name] = {};
                }

                if (inv.items && Array.isArray(inv.items)) {
                    inv.items.forEach(item => {
                        let matName = (item.name || 'مادة عامة').trim();
                        let qty = Number(item.qty || 0);
                        customersMaterialsMap[name][matName] = (customersMaterialsMap[name][matName] || 0) + qty;
                    });
                }
            }
        });

        repSnap.forEach(doc => {
            const rep = doc.data();
            repaymentsList.push({ id: doc.id, ...rep });
            let name = (rep.customerName || '').trim();
            let amount = Number(rep.amount || 0);
            if (customersDebtMap[name] !== undefined) {
                customersDebtMap[name] -= amount;
            } else {
                customersDebtMap[name] = -amount;
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
                    repHtml += `
                        <tr>
                            <td style="padding:8px; border:1px solid #ddd;"><b>${rep.customerName}</b></td>
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

        let debtHtml = `
            <table class="items-table" style="width:100%; border-collapse: collapse; background:#fff;">
                <thead>
                    <tr style="background:#f2f2f2;">
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">اسم الزبون / الشركة</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">إجمالي الدين المتبقي ($)</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">المواد والكميات المسحوبة بالدين</th>
                    </tr>
                </thead>
                <tbody>
        `;

let hasDebt = false;
        let totalGeneralDebt = 0;
        for (let cust in customersDebtMap) {
            let remainingDebt = Number(customersDebtMap[cust] || 0);

            // إذا تم سداد كامل الدين (الرصيد صفر أو أقل)، نحذفه من قائمة المواد المحذوفة يدوياً ونخفيه من الجدول
            if (remainingDebt <= 0) {
                clearedCustomers = clearedCustomers.filter(c => c !== cust);
                localStorage.setItem(clearedKey, JSON.stringify(clearedCustomers));
                continue;
            }

            hasDebt = true;
totalGeneralDebt += remainingDebt;
            let materialsText = '---';
            if (!clearedCustomers.includes(cust) && customersMaterialsMap[cust]) {
                let parts = [];
                for (let mat in customersMaterialsMap[cust]) {
                    let q = customersMaterialsMap[cust][mat];
                    parts.push(`${mat}: <b>${q.toFixed(2)} م3</b>`);
                }
                if (parts.length > 0) {
                    const safeCust = cust.replace(/'/g, "\\'");
                    materialsText = `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <span>${parts.join(' ، ')}</span>
                            <button type="button" onclick="clearCustomerDebtMaterials('${safeCust}')" title="إخفاء سجل المواد لهذا الزبون" style="background:#e67e22; color:white; border:none; padding:2px 7px; border-radius:3px; cursor:pointer; font-size:11px; white-space:nowrap;">حذف المواد</button>
                        </div>
                    `;
                }
            }

            debtHtml += `
                <tr>
                    <td style="padding:10px; border:1px solid #ddd;"><b>${cust}</b></td>
                    <td style="padding:10px; border:1px solid #ddd; color:#c0392b; font-weight:bold;">$${remainingDebt.toFixed(2)}</td>
                    <td style="padding:10px; border:1px solid #ddd; font-size:13px;">${materialsText}</td>
                </tr>
            `;
        }

        if (!hasDebt) {
            debtHtml += `<tr><td colspan="3" style="text-align:center; padding:10px; color:#666;">لا توجد ديون مترتبة على الزبائن حالياً</td></tr>`;
        }
        debtHtml += `</tbody></table>`;
        debtsContainer.innerHTML = debtHtml;
const totalGeneralDebtsEl = document.getElementById('totalGeneralDebts');
if (totalGeneralDebtsEl) {
    totalGeneralDebtsEl.innerText = `${totalGeneralDebt.toFixed(2)} $`;
}
    }).catch(err => {
        console.error("خطأ في جلب بيانات الديون: ", err);
    });
}

window.deleteRepayment = function(id) {
    if (confirm("هل تريد حذف هذه الدفعة المحصلة نهائياً؟")) {
        repaymentsCollection.doc(id).delete().then(() => {
            alert("تم الحذف بنجاح!");
            loadDebtsTable();
            calculateCashflow();
        }).catch(err => console.error("خطأ في الحذف: ", err));
    }
};

window.filterDebts = function() {
    let input = document.getElementById('searchDebtCustomer').value.toLowerCase();
    let rows = document.querySelectorAll('#debtsListTable tbody tr');
    rows.forEach(row => {
        let name = row.cells[0] ? row.cells[0].textContent.toLowerCase() : '';
        if (name.includes(input)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
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

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
            if (inv.isoDate === selectedDateStr || inv.date === selectedDateStr) {
                const amount = Number(inv.grandTotal || 0);
                if (inv.paymentStatus === 'دين') {
                    totalNewDebts += amount;
                } else {
                    totalCashSales += amount;
                }
            }
        });

        // تم تصحيح اسم المتغير هنا إلى repSnap بدلاً من repSnapshot
        repSnap.forEach((doc) => {
            const rep = doc.data();
            if (rep.date === selectedDateStr) {
                totalRepaidDebts += Number(rep.amount || 0);
            }
        });

        expSnap.forEach((doc) => {
            const exp = doc.data();
            if (exp.isoDate === selectedDateStr || exp.date === selectedDateStr) {
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

// دالة جلب الأرشيف وترتيبه تصاعدياً مع فلترة حسب مقلع المحاسب الحالي
function loadInvoices() {
    const archiveContainer = document.getElementById('fullArchiveList');
    const myQuarryName = localStorage.getItem('savedQuarryName') || '';

    invoicesCollection.get().then((querySnapshot) => {
        let invoicesList = [];
        querySnapshot.forEach((doc) => {
            const invData = doc.data();
            if (!myQuarryName || invData.quarryName === myQuarryName) {
                invoicesList.push({ firebaseId: doc.id, ...invData });
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
        
        calculateCashflow();

        if (archiveContainer) {
            // إعادة بناء رأس الجدول بشكل صحيح ومنظم
           let html = `
    <table class="items-table" style="width: 100%; margin-top: 10px; border-collapse: collapse;">
        <thead>
            <tr style="background: #8B5A2B; color: white;">
                <th style="padding: 10px; border: 1px solid #ddd; width: 15%;">المقلع</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">رقم الدور</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">التاريخ</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 15%;">اسم الزبون</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">السائق</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 20%;">المواد والكميات</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">الإجمالي ($)</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">حالة الدفع</th>
                <th style="padding: 10px; border: 1px solid #ddd; width: 10%;">إجراء</th>
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

                html += `
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>${inv.quarryName || 'غير مسمى'}</b></td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>#${inv.turnNumber || inv.queueNumber || 1}</b></td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${inv.date || '---'}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>${inv.customerName || '---'}</b></td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${inv.carNumber || '---'}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${itemsSummary}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;"><b>$${Number(inv.grandTotal || 0).toFixed(2)}</b></td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center; color:${inv.paymentStatus === 'دين' ? 'red' : 'green'}; font-weight:bold;">${inv.paymentStatus || '---'}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">
                            <button class="btn-del" onclick="deleteInvoice('${inv.firebaseId}')" style="background:#c0392b; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">حذف X</button>
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
        db.collection("invoices").doc(firebaseId).delete().then(() => {
            alert("تم الحذف بنجاح!");
            loadInvoices();
        }).catch((error) => {
            console.error("خطأ في الحذف: ", error);
        });
    }
};

// المراسلة الفورية
function getMessages() { return JSON.parse(localStorage.getItem('quarry_messages') || '[]'); }
function saveMessages(msgs) { localStorage.setItem('quarry_messages', JSON.stringify(msgs)); }

const btnSendMsg = document.getElementById('btnSendMsg');
if (btnSendMsg) {
    btnSendMsg.addEventListener('click', function() {
        const text = document.getElementById('msgInput').value.trim();
        const quarry = document.getElementById('quarryName').value.trim() || 'مقلع غير مسمى';
        if (!text) return;

        const msgs = getMessages();
        msgs.push({ id: Date.now(), sender: quarry, receiver: "المشرف العام", text: text, time: new Date().toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' }) });
        saveMessages(msgs);
        document.getElementById('msgInput').value = '';
        loadChatMessages();
    });
}

function loadChatMessages() {
    const msgs = getMessages();
    const box = document.getElementById('chatMessages');
    if (!box) return;
    const myQuarry = document.getElementById('quarryName').value.trim();
    box.innerHTML = '';
    msgs.forEach(m => {
        if (m.sender === myQuarry || m.receiver === myQuarry) {
            box.innerHTML += `
                <div class="chat-msg ${m.sender === myQuarry ? 'msg-sender' : 'msg-receiver'}">
                    <div><strong>${m.sender}:</strong> ${m.text} <span style="font-size:10px; color:#888;">${m.time}</span></div>
                    <button class="btn-del-msg" onclick="deleteMessage(${m.id})">حذف</button>
                </div>
            `;
        }
    });
}

window.deleteMessage = function(id) {
    let msgs = getMessages().filter(m => m.id !== id);
    saveMessages(msgs);
    loadChatMessages();
};

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
    loadDailyMaterialsStats(); // تم إضافة استدعاء جدول الإحصاء اليومي هنا
});
// دالة تحميل وحساب إحصاء المواد المباعة اليومية حسب التاريخ
function loadDailyMaterialsStats() {
    const dateFilterEl = document.getElementById('dailyMaterialsDateFilter');
    const dailyBody = document.getElementById('dailyMaterialsStatsBody');
    if (!dailyBody) return;

    // جلب اسم المقلع الحالي لضمان العزل التام
    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    let selectedDateStr = dateFilterEl && dateFilterEl.value ? dateFilterEl.value : new Date().toLocaleDateString('en-CA');

    // إضافة شرط العزل `.where('quarryName', '==', currentQuarry)` لجلب فواتير المقلع الحالي فقط
    invoicesCollection.where('quarryName', '==', currentQuarry).get().then((querySnapshot) => {
        let dailyMaterialsMap = {};
        let dayTotalQty = 0;
        let dayTotalMoney = 0;

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
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
        const statsTitle = document.querySelector('h3, h4'); 
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

    // جلب اسم المقلع الحالي لضمان العزل التام وعدم تداخل البيانات بين المقالع
    const currentQuarry = localStorage.getItem('savedQuarryName') || '';
    if (!currentQuarry) return;

    // إضافة شرط العزل `.where('quarryName', '==', currentQuarry)` لجلب مبيعات المقلع الحالي فقط
    invoicesCollection.where('quarryName', '==', currentQuarry).get().then((querySnapshot) => {
        let comprehensiveMap = {};
        let totalQtyAll = 0;
        let totalMoneyAll = 0;

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
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

    // التحقق من إدخال التواريخ
    if (!startDateInput || !endDateInput) {
        alert('الرجاء تحديد تاريخ البداية وتاريخ النهاية معاً!');
        return;
    }

    // تحويل التواريخ المدخلة إلى صيغة مقارنة (مقارنة النصوص YYYY-MM-DD تعمل بكفاءة عالية)
    if (startDateInput > endDateInput) {
        alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساوياً له!');
        return;
    }

    rangeBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px; color:#666;">جاري تحميل وعرض البيانات...</td></tr>`;

    invoicesCollection.get().then((querySnapshot) => {
        let rangeMap = {};
        let totalQtyRange = 0;
        let totalMoneyRange = 0;
        let countMatched = 0;

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
            
            // استخراج التاريخ من الفاتورة (تأكد أن حقل التاريخ في الفاتورة لديك يخزن بصيغة YYYY-MM-DD مثل inv.date أو inv.invoiceDate)
            // إذا كان اسم الحقل مختلفاً لديك (مثلاً inv.createdAt أو inv.date)، استبدله هنا:
            let invDate = inv.date || inv.invoiceDate || '';
            
            // إذا كان التاريخ مخزناً كـ Firebase Timestamp، نقوم بتحويله لـ string
            if (invDate && typeof invDate.toDate === 'function') {
                invDate = invDate.toDate().toISOString().split('T')[0];
            } else if (invDate && invDate.includes('T')) {
                invDate = invDate.split('T')[0];
            }

            // فحص ما إذا كانت الفاتورة تقع ضمن النمط (من تاريخ إلى تاريخ شاملة)
            if (invDate && invDate >= startDateInput && invDate <= endDateInput) {
                if (inv.items && Array.isArray(inv.items)) {
                    countMatched++;
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
// حفظ وتثبيت هوية المقلع الكاملة (الاسم + العنوان + الهاتف)
function saveQuarryNameSetting() {
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

    alert(`تم حفظ وتثبيت هوية (${nameVal}) بنجاح!`);
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
// دالة فحص الرسائل الجديدة والتنبيهات من المشرف العام
function checkNewMessages() {
    const myQuarryName = localStorage.getItem('savedQuarryName');
    if (!myQuarryName) return;

    // جلب الرسائل من التخزين المحلي
    const msgs = JSON.parse(localStorage.getItem('quarry_messages') || '[]');
    
    // عد الرسائل الواردة من المشرف العام والتي لم يتم قراءتها (أو إجمالي الرسائل الجديدة)
    // يمكنك تعديل الشرط بحسب رغبتك (مثلاً الرسائل التي يكون مرسلها "المشرف العام" وموجهة لمقلك الحالي)
    const unreadCount = msgs.filter(m => m.receiver === myQuarryName && m.sender === "المشرف العام" && !m.read).length;

    const badge = document.getElementById('msgBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.innerText = unreadCount;
            badge.style.display = 'inline-block'; // إظهار الشارة الحمراء
        } else {
            badge.style.display = 'none'; // إخفاء الشارة في حال عدم وجود رسائل جديدة
        }
    }
}

// تشغيل دالة الفحص تلقائياً كل بضع ثوانٍ لضمان التحديث الفوري
setInterval(checkNewMessages, 3000);

// تشغيلها أيضاً فور فتح الصفحة
document.addEventListener("DOMContentLoaded", () => {
    checkNewMessages();
});
