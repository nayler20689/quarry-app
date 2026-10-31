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

// مرجع مجموعة الفواتير
const invoicesCollection = db.collection("invoices");
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
        loadMaterialStats();
    } else if (tabName === 'archive') {
        btns[5].classList.add('active');
        document.getElementById('tabArchive').classList.add('active');
        loadFullArchive();
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
        <td><input type="number" class="item-qty" value="0" min="0"></td>
        <td><input type="number" class="item-price" value="0" min="0"></td>
        <td><input type="text" class="item-total" value="0.00 $" readonly></td>
        <td><button type="button" class="btn-del-row" onclick="removeRow(this)">X</button></td>
    `;
    tbody.appendChild(tr);
    
    // هذا السطر هو المهم جداً ليعمل الحساب على السطر الجديد فوراً
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
        qty.oninput = calculateGrandTotal;
        price.oninput = calculateGrandTotal;
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

// دالة جلب وحفظ البيانات من الذاكرة المحلية
function getInvoices() {
    return JSON.parse(localStorage.getItem('crusher_invoices') || '[]');
}

function saveInvoices(data) {
    localStorage.setItem('crusher_invoices', JSON.stringify(data));
}

// ----------------- الفقرة 1 و 2 و 6: الحفظ والطباعة ورقم الدور -----------------
document.getElementById('btnSaveAndPrint').addEventListener('click', function() {
    const customerName = document.getElementById('customerName').value.trim();
    const carNumber = document.getElementById('carNumber').value.trim();
    const paymentStatus = document.getElementById('paymentStatus').value;
    const quarryName = document.getElementById('quarryName').value.trim() || 'مقلع أبناء عبد الغفور الصياح';

    if (!customerName) {
        alert("يرجى إدخال اسم الزبون أولاً!");
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

    let invoices = getInvoices();
    const todayStrFixed = new Date().toLocaleDateString('en-CA');
    const lastSavedDate = localStorage.getItem('lastQueueDate');
    let lastQueueNum = parseInt(localStorage.getItem('lastQueueNum')) || 0;

    let queueNumber;
    if (lastSavedDate !== todayStrFixed) {
        queueNumber = 1;
    } else {
        queueNumber = lastQueueNum + 1;
    }

    localStorage.setItem('lastQueueNum', queueNumber);
    localStorage.setItem('lastQueueDate', todayStrFixed);

    const newInvoice = {
        id: Date.now(),
        queueNumber: queueNumber,
        turnNumber: queueNumber,
        quarryName,
        date: new Date().toLocaleDateString('ar-SY'),
        rawDate: todayStrFixed,
        customerName,
        carNumber: carNumber || '---',
        paymentStatus,
        items,
        grandTotal: document.getElementById('grandTotal').innerText
    };

    // إرسال الفاتورة إلى قاعدة بيانات Firebase السحابية
    invoicesCollection.add(newInvoice)
    .then(() => {
        console.log("تم حفظ الفاتورة في السحاب بنجاح!");
    })
    .catch((error) => {
        console.error("خطأ في الاتصال، تم الحفظ محلياً: ", error);
    });

    const wantPrint = confirm("تم حفظ الفاتورة بنجاح بالأرشيف!\n\nهل تريد طباعة الوصل الآن؟");
    if (wantPrint) {
        if(document.getElementById('pQuarryHeader')) document.getElementById('pQuarryHeader').innerText = quarryName;
        if(document.getElementById('pDate')) document.getElementById('pDate').innerText = 'التاريخ: ' + new Date().toLocaleDateString('ar-SY') + ' ' + new Date().toLocaleTimeString('ar-SY', {hour: '2-digit', minute:'2-digit'});
        if(document.getElementById('pQueueNum')) document.getElementById('pQueueNum').innerText = 'A-' + queueNumber;
        if(document.getElementById('pCustomer')) document.getElementById('pCustomer').innerText = customerName;
        if(document.getElementById('pDriver')) document.getElementById('pDriver').innerText = carNumber || '---';
        if(document.getElementById('pPayment')) document.getElementById('pPayment').innerText = paymentStatus;

        const container = document.getElementById('pItemsTableContainer');
        if (container) {
            container.innerHTML = '';
            
            if (items.length >= 2) {
                const printItem1 = items[0]; 
                const printItem2 = items[1]; 
                
                container.innerHTML = `
                    <tr>
                        <td class="bg-gray bold text-center" style="width: 50%;">البضاعة 2</td>
                        <td class="bg-gray bold text-center" style="width: 50%;">البضاعة 1</td>
                    </tr>
                    <tr>
                        <td class="text-center" style="width: 50%; border-left: 1px solid #000;">${printItem2.name}</td>
                        <td class="text-center" style="width: 50%;">${printItem1.name}</td>
                    </tr>
                    <tr>
                        <td class="bg-gray bold text-center" style="border-left: 1px solid #000;">كمية 2</td>
                        <td class="bg-gray bold text-center">كمية 1</td>
                    </tr>
                    <tr>
                        <td class="bold text-center" style="border-left: 1px solid #000;">${printItem2.qty} متر</td>
                        <td class="bold text-center">${printItem1.qty} متر</td>
                    </tr>
                `;
            } else if (items.length === 1) {
                const printItem = items[0];
                container.innerHTML = `
                    <tr>
                        <td class="bg-gray bold text-center" style="width: 50%;">البضاعة</td>
                        <td class="text-center" style="width: 50%;">${printItem.name}</td>
                    </tr>
                    <tr>
                        <td class="bg-gray bold text-center">الكمية</td>
                        <td class="bold text-center">${printItem.qty} متر</td>
                    </tr>
                `;
            }
        }

        setTimeout(() => {
            window.print();
        }, 100);
    } 

    if (typeof resetForm === 'function') {
        resetForm();
    }
});

// ----------------- الفقرة 3: كشف الحساب والديون -----------------
function loadDebtsTable() {
    const invoices = getInvoices();
    const debtsMap = {};

    invoices.forEach(inv => {
        if (inv.paymentStatus === 'دين') {
            const name = inv.customerName;
            const amt = parseFloat(inv.grandTotal) || 0;
            debtsMap[name] = (debtsMap[name] || 0) + amt;
        }
    });

    window.currentDebtsMap = debtsMap;
    renderDebtsUI(debtsMap);
}

function renderDebtsUI(debtsMap) {
    const box = document.getElementById('debtsListTable');
    if (!box) return;
    const customers = Object.keys(debtsMap);

    if (customers.length === 0) {
        box.innerHTML = '<p style="color:green; font-weight:bold;">لا توجد ديون مسجلة على أي زبون حالياً.</p>';
        return;
    }

    let html = `<table class="items-table">
        <thead>
            <tr>
                <th>اسم الزبون</th>
                <th>إجمالي المبلغ المستحق (دين)</th>
                <th>إجراءات الحساب</th>
            </tr>
        </thead>
        <tbody>`;

    customers.forEach(cust => {
        if (debtsMap[cust] > 0) {
            html += `<tr>
                <td><b>${cust}</b></td>
                <td style="color:red; font-weight:bold; font-size:16px;">${debtsMap[cust].toFixed(2)} $</td>
                <td>
                    <button class="btn-edit" onclick="payDebt('${cust}')">تسديد جزء/كامل الدين</button>
                    <button class="btn-delete" onclick="clearDebt('${cust}')">حذف الدين بالكامل</button>
                </td>
            </tr>`;
        }
    });

    html += `</tbody></table>`;
    box.innerHTML = html;
}

window.filterDebts = function() {
    const searchInput = document.getElementById('searchDebtCustomer');
    if (!searchInput) return;
    const q = searchInput.value.toLowerCase();
    const filteredMap = {};
    for (let c in window.currentDebtsMap) {
        if (c.toLowerCase().includes(q)) filteredMap[c] = window.currentDebtsMap[c];
    }
    renderDebtsUI(filteredMap);
};

window.payDebt = function(cust) {
    const payAmt = parseFloat(prompt(`أدخل المبلغ المسدد من الزبون (${cust}):`, "0"));
    if (payAmt && payAmt > 0) {
        const repayments = JSON.parse(localStorage.getItem('crusher_repayments') || '[]');
        repayments.push({
            customer: cust,
            amount: payAmt,
            date: new Date().toLocaleDateString('ar-SY'),
            isoDate: new Date().toISOString().split('T')[0]
        });
        localStorage.setItem('crusher_repayments', JSON.stringify(repayments));
        alert("تم تسديد المبلغ وتسجيله في حركة الصندوق اليومية!");
        loadDebtsTable();
    }
};

window.clearDebt = function(cust) {
    if (confirm(`هل أنت تأكد من تسوية وحذف كافة الديون المترتبة على الزبون (${cust})؟`)) {
        let invoices = getInvoices();
        invoices.forEach(inv => {
            if (inv.customerName === cust && inv.paymentStatus === 'دين') {
                inv.paymentStatus = 'مسدد بالكامل';
            }
        });
        saveInvoices(invoices);
        loadDebtsTable();
    }
};

// ----------------- الفقرة 4: حركة الصندوق حسب التاريخ -----------------
window.calculateCashflow = function() {
    const dateInput = document.getElementById('cashDateFilter');
    if (!dateInput || !dateInput.value) return;
    const dateVal = dateInput.value;

    const invoices = getInvoices();
    const expenses = JSON.parse(localStorage.getItem('crusher_expenses') || '[]');
    const repayments = JSON.parse(localStorage.getItem('crusher_repayments') || '[]');

    let cashSales = 0, newDebts = 0, totalExp = 0, debtRepaid = 0;

    invoices.forEach(inv => {
        if (inv.isoDate === dateVal) {
            const tot = parseFloat(inv.grandTotal) || 0;
            if (inv.paymentStatus === 'نقداً') cashSales += tot;
            else if (inv.paymentStatus === 'دين') newDebts += tot;
        }
    });

    expenses.forEach(e => {
        if (e.isoDate === dateVal) totalExp += (parseFloat(e.amount) || 0);
    });

    repayments.forEach(r => {
        if (r.isoDate === dateVal) debtRepaid += (parseFloat(r.amount) || 0);
    });

    if(document.getElementById('cashSalesVal')) document.getElementById('cashSalesVal').innerText = cashSales.toFixed(2) + ' $';
    if(document.getElementById('cashRepaidVal')) document.getElementById('cashRepaidVal').innerText = debtRepaid.toFixed(2) + ' $';
    if(document.getElementById('cashExpensesVal')) document.getElementById('cashExpensesVal').innerText = totalExp.toFixed(2) + ' $';
    if(document.getElementById('cashNewDebtsVal')) document.getElementById('cashNewDebtsVal').innerText = newDebts.toFixed(2) + ' $';

    const netCash = (cashSales + debtRepaid) - totalExp;
    if(document.getElementById('finalCashBalance')) document.getElementById('finalCashBalance').innerText = netCash.toFixed(2) + ' $';
};

// حفظ المصاريف
const btnSaveExpense = document.getElementById('btnSaveExpense');
if (btnSaveExpense) {
    btnSaveExpense.addEventListener('click', function() {
        const title = document.getElementById('expenseTitle').value.trim();
        const amount = parseFloat(document.getElementById('expenseAmount').value) || 0;

        if (!title || amount <= 0) {
            alert("يرجى إدخال بيان المصروف والمبلغ بدقة!");
            return;
        }

        const expenses = JSON.parse(localStorage.getItem('crusher_expenses') || '[]');
        expenses.push({
            title, amount,
            date: new Date().toLocaleDateString('ar-SY'),
            isoDate: new Date().toISOString().split('T')[0]
        });
        localStorage.setItem('crusher_expenses', JSON.stringify(expenses));

        alert("تم حفظ المصروف بنجاح!");
        document.getElementById('expenseTitle').value = '';
        document.getElementById('expenseAmount').value = '';
    });
}

// ----------------- الفقرة 7: إحصاء المواد المباعة التراكمي -----------------
function loadMaterialStats() {
    const invoices = getInvoices();
    const stats = {};

    invoices.forEach(inv => {
        if(inv.items && Array.isArray(inv.items)) {
            inv.items.forEach(item => {
                if (!stats[item.name]) stats[item.name] = { qty: 0, total: 0 };
                stats[item.name].qty += parseFloat(item.qty) || 0;
                stats[item.name].total += parseFloat(item.total) || 0;
            });
        }
    });

    const tbody = document.getElementById('materialsStatsBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const keys = Object.keys(stats);
    if (keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">لا توجد إحصائيات مواد مباعة حتى الآن.</td></tr>';
        return;
    }

    keys.forEach(k => {
        tbody.innerHTML += `
            <tr>
                <td><b>${k}</b></td>
                <td><b style="color:#2980b9;">${stats[k].qty.toFixed(2)} م3</b></td>
                <td><b>${stats[k].total.toFixed(2)} $</b></td>
            </tr>
        `;
    });
}

// ----------------- الأرشيف الكامل -----------------
function loadFullArchive() {
    const invoices = getInvoices();
    const archiveBox = document.getElementById('fullArchiveList');
    if (!archiveBox) return;

    if (invoices.length === 0) {
        archiveBox.innerHTML = '<p style="color:red; font-weight:bold;">لا توجد أي فواتير مسجلة في الأرشيف حالياً.</p>';
        return;
    }

    let html = `<table class="items-table">
        <thead>
            <tr>
                <th>رقم الدور</th>
                <th>المقلع</th>
                <th>التاريخ</th>
                <th>اسم الزبون</th>
                <th>السائق</th>
                <th>المواد والكميات</th>
                <th>الإجمالي ($)</th>
                <th>حالة الدفع</th>
                <th>إجراءات</th>
            </tr>
        </thead>
        <tbody>`;

    invoices.slice().reverse().forEach(inv => {
        let itemsSummary = (inv.items && Array.isArray(inv.items)) ? inv.items.map(i => `${i.name}: ${i.qty}م3 × ${i.price}$`).join(' | ') : '';
        html += `<tr>
            <td><span style="background:#2c3e50; color:white; padding:2px 6px; border-radius:3px;">A-${inv.turnNumber || inv.queueNumber || 1}</span></td>
            <td><b style="color:#2980b9;">${inv.quarryName}</b></td>
            <td>${inv.date}</td>
            <td><b>${inv.customerName}</b></td>
            <td>${inv.carNumber || '---'}</td>
            <td>${itemsSummary}</td>
            <td><b>${inv.grandTotal}</b></td>
            <td style="color:${inv.paymentStatus === 'دين' ? 'red' : 'green'}; font-weight:bold;">${inv.paymentStatus}</td>
            <td><button class="btn-delete" onclick="deleteInvoice(${inv.id})">حذف</button></td>
        </tr>`;
    });

    html += `</tbody></table>`;
    archiveBox.innerHTML = html;
}

window.deleteInvoice = function(id) {
    if (confirm("هل أنت تأكد من حذف هذه الفاتورة من الأرشيف؟")) {
        let invoices = getInvoices().filter(i => i.id !== id);
        saveInvoices(invoices);
        loadFullArchive();
    }
};

// ----------------- المراسلة الفورية -----------------
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
            <td><input type="number" class="item-qty" value="0" min="0"></td>
            <td><input type="number" class="item-price" value="0" min="0"></td>
            <td><input type="text" class="item-total" value="0.00 $" readonly></td>
            <td><button type="button" class="btn-del-row" onclick="removeRow(this)">X</button></td>
        </tr>
    `;
    document.getElementById('grandTotal').innerText = '0.00 $';
    attachEventsToRows();
}
// تفعيل الأحداث على الحقول عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
    attachEventsToRows();
});
// دالة لجلب وعرض الفواتير وتفعيل كافة التقارير والحذف الفوري
function loadInvoices() {
    const archiveContainer = document.getElementById('fullArchiveList');
    
    firebase.firestore().collection("invoices").get().then((querySnapshot) => {
        let invoicesList = [];
        querySnapshot.forEach((doc) => {
            // حفظ معرّف المستند الصحيح من فايربيس
            invoicesList.push({ firebaseId: doc.id, ...doc.data() });
        });

        // 1. عرض الأرشيف مع زر الحذف المربوط بصورة صحيحة
        if (archiveContainer) {
            if (invoicesList.length === 0) {
                archiveContainer.innerHTML = "<p style='padding:10px; color:#666;'>لا توجد فواتير مسجلة حتى الآن.</p>";
            } else {
                let tableHTML = `
                    <table class="items-table" style="width:100%; margin-top:10px; border-collapse: collapse; background:#fff;">
                        <thead>
                            <tr style="background:#f2f2f2;">
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">اسم الشركة / الزبون</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">السائق</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">حالة الدفع</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">المجموع ($)</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:center;">إجراء</th>
                            </tr>
                        </thead>
                        <tbody>
                `;

                invoicesList.forEach((inv) => {
                    const amount = inv.totalAmount || inv.total || inv.grandTotal || inv.sum || 0;
                    tableHTML += `
                        <tr>
                            <td style="padding:10px; border:1px solid #ddd;">${inv.customerName || '---'}</td>
                            <td style="padding:10px; border:1px solid #ddd;">${inv.carNumber || '---'}</td>
                            <td style="padding:10px; border:1px solid #ddd;">${inv.paymentStatus || '---'}</td>
                            <td style="padding:10px; border:1px solid #ddd; font-weight:bold; color:#27ae60;">$${amount}</td>
                            <td style="padding:10px; border:1px solid #ddd; text-align:center;">
                                <button type="button" onclick="deleteInvoice('${inv.firebaseId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">حذف X</button>
                            </td>
                        </tr>
                    `;
                });

                tableHTML += `</tbody></table>`;
                archiveContainer.innerHTML = tableHTML;
            }
        }

        // 2. تحديث التقارير وحركة الصندوق والمواد المباعة تلقائياً
        updateDailyCashReport(invoicesList);
        updateMaterialsStatsReport(invoicesList);

    }).catch((error) => {
        console.error("خطأ في جلب البيانات: ", error);
    });
}

// دالة آمنة لجلب وعرض الفواتير والأرشيف مع زر الحذف فقط دون التأثير على الواجهة
function loadInvoices() {
    const archiveContainer = document.getElementById('fullArchiveList');
    if (!archiveContainer) return;

    firebase.firestore().collection("invoices").get().then((querySnapshot) => {
        let invoicesList = [];
        querySnapshot.forEach((doc) => {
            invoicesList.push({ firebaseId: doc.id, ...doc.data() });
        });

        if (invoicesList.length === 0) {
            archiveContainer.innerHTML = "<p style='padding:10px; color:#666;'>لا توجد فواتير مسجلة حتى الآن.</p>";
            return;
        }

        let tableHTML = `
            <table class="items-table" style="width:100%; margin-top:10px; border-collapse: collapse; background:#fff;">
                <thead>
                    <tr style="background:#f2f2f2;">
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">اسم الشركة / الزبون</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">السائق</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">حالة الدفع</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:right;">المجموع ($)</th>
                        <th style="padding:10px; border:1px solid #ddd; text-align:center;">إجراء</th>
                    </tr>
                </thead>
                <tbody>
        `;

        invoicesList.forEach((inv) => {
            const amount = Number(inv.totalAmount || inv.total || inv.grandTotal || inv.sum || 0);
            tableHTML += `
                <tr>
                    <td style="padding:10px; border:1px solid #ddd;">${inv.customerName || '---'}</td>
                    <td style="padding:10px; border:1px solid #ddd;">${inv.carNumber || '---'}</td>
                    <td style="padding:10px; border:1px solid #ddd;">${inv.paymentStatus || '---'}</td>
                    <td style="padding:10px; border:1px solid #ddd; font-weight:bold; color:#27ae60;">$${amount.toFixed(2)}</td>
                    <td style="padding:10px; border:1px solid #ddd; text-align:center;">
                        <button type="button" onclick="deleteInvoice('${inv.firebaseId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">حذف X</button>
                    </td>
                </tr>
            `;
        });

        tableHTML += `</tbody></table>`;
        archiveContainer.innerHTML = tableHTML;

    }).catch((error) => {
        console.error("خطأ في جلب الأرشيف: ", error);
    });
}

// دالة حذف الفاتورة من السحاب
window.deleteInvoice = function(firebaseId) {
    if (!firebaseId) return;
    
    if (confirm("هل أنت متأكد من حذف هذه الفاتورة نهائياً؟")) {
        firebase.firestore().collection("invoices").doc(firebaseId).delete().then(() => {
            alert("تم الحذف بنجاح!");
            loadInvoices();
        }).catch((error) => {
            console.error("خطأ في الحذف: ", error);
        });
    }
};

// التشغيل الأساسي عند التحميل
window.addEventListener('DOMContentLoaded', () => {
    loadInvoices();
});
