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
        <td><input type="number" class="item-qty" value="0" min="0"></td>
        <td><input type="number" class="item-price" value="0" min="0"></td>
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

// ----------------- الحفظ والطباعة ورقم الدور -----------------
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

    const grandTotalText = document.getElementById('grandTotal').innerText;
    const numericGrandTotal = parseFloat(grandTotalText.replace('$', '')) || 0;

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
        queueNumber: queueNumber,
        turnNumber: queueNumber,
        quarryName,
        date: new Date().toLocaleDateString('ar-SY'),
        isoDate: todayStrFixed,
        customerName,
        carNumber: carNumber || '---',
        paymentStatus,
        items,
        grandTotal: numericGrandTotal
    };

    // إرسال الفاتورة إلى قاعدة بيانات Firebase السحابية
    invoicesCollection.add(newInvoice)
    .then(() => {
        console.log("تم حفظ الفاتورة في السحاب بنجاح!");
        loadInvoices(); // تحديث العرض والصندوق فور الحفظ
    })
    .catch((error) => {
        console.error("خطأ في الاتصال بالباعثة السحابية: ", error);
        alert("حدث خطأ أثناء الحفظ بالسحابة!");
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
                container.innerHTML = `
                    <tr>
                        <td class="bg-gray bold text-center" style="width: 50%;">البضاعة 2</td>
                        <td class="bg-gray bold text-center" style="width: 50%;">البضاعة 1</td>
                    </tr>
                    <tr>
                        <td class="text-center" style="width: 50%; border-left: 1px solid #000;">${items[1].name}</td>
                        <td class="text-center" style="width: 50%;">${items[0].name}</td>
                    </tr>
                    <tr>
                        <td class="bg-gray bold text-center" style="border-left: 1px solid #000;">كمية 2</td>
                        <td class="bg-gray bold text-center">كمية 1</td>
                    </tr>
                    <tr>
                        <td class="bold text-center" style="border-left: 1px solid #000;">${items[1].qty} متر</td>
                        <td class="bold text-center">${items[0].qty} متر</td>
                    </tr>
                  `;
              } else if (items.length === 1) {
                container.innerHTML = `
                    <tr>
                        <td class="bg-gray bold text-center" style="width: 50%;">البضاعة</td>
                        <td class="text-center" style="width: 50%;">${items[0].name}</td>
                    </tr>
                    <tr>
                        <td class="bg-gray bold text-center">الكمية</td>
                        <td class="bold text-center">${items[0].qty} متر</td>
                    </tr>
                `;
            }
        }

        setTimeout(() => {
            window.print();
        }, 100);
    } 

    resetForm();
});

// ----------------- دالة حساب حركة الصندوق اليومية (محدثة حسب واجهتك) -----------------
function calculateCashflow() {
    const dateFilterEl = document.getElementById('cashDateFilter');
    let selectedDateStr = '';
    
    if (dateFilterEl && dateFilterEl.value) {
        selectedDateStr = dateFilterEl.value; // صيغة YYYY-MM-DD
    } else {
        selectedDateStr = new Date().toLocaleDateString('en-CA');
    }

    invoicesCollection.get().then((querySnapshot) => {
        let totalCashSales = 0;
        let totalNewDebts = 0;

        querySnapshot.query && querySnapshot.forEach ? querySnapshot.forEach(doc => {}) : null;

        querySnapshot.forEach((doc) => {
            const inv = doc.data();
            // مطابقة التاريخ مع isoDate أو تاريخ الفاتورة المحلي
            if (inv.isoDate === selectedDateStr || inv.date === selectedDateStr) {
                const amount = Number(inv.grandTotal || 0);
                if (inv.paymentStatus === 'دين') {
                    totalNewDebts += amount;
                } else {
                    totalCashSales += amount;
                }
            }
        });

        // تحديث الحقول الأربعة الموجودة في واجهة "حركة الصندوق اليومية والمالية"
        // البحث عن العناصر بناءً على الترتيب أو النصوص المجاورة في الواجهة لديك:
        // 1. مبيعات النقد اليوم ($)
        const cashSalesBoxes = document.querySelectorAll('.tab-content #tabCashflow .box, .tab-content #tabCashflow div, div');
        
        // طريقة آمنة لتحديث الحقول عبر ضبط الـ IDs أو تحديثها بالترتيب بناءً على واجهتك
        // سنبحث عن العنصر الذي يحمل القيمة الافتراضية $0.00 تحت العناوين المطابقة
        const allCardDivs = document.querySelectorAll('.tab-content div, .tab-content span, div');
        
        // تحديث المربعات عبر البحث عن الحقول المخصصة (يمكنك إضافة IDs في ملف الـ HTML إذا لم تكن موجودة، أو استخدام الكود أدناه مباشرة)
        // تحديث مبيعات النقد (المربع الأول)
        const box1 = document.getElementById('cashSalesValue') || document.querySelector('#tabCashflow div:nth-child(1) .value, #tabCashflow');
        
        // تحديث القيم مباشرة عبر دالة تعبئة ذكية بالاعتماد على النصوص الظاهرة في الصورة:
        updateCardValueByText("1. مبيعات النقد اليوم ($)", `$${totalCashSales.toFixed(2)}`);
        updateCardValueByText("4. ديون جديدة مسجلة اليوم ($)", `$${totalNewDebts.toFixed(2)}`);

        // تحديث الرصيد الصافي الفعلي بالصندوق في نهاية اليوم
        const netBalanceEl = document.getElementById('netBalanceValue') || findElementContainingText("الرصيد الصافي الفعلي بالصندوق في نهاية اليوم");
        if (netBalanceEl) {
            // البحث عن النص وتغيير القيمة التي تحته مباشرة
            let targetNode = netBalanceEl.nextElementSibling || netBalanceEl.parentElement.querySelector('span, b, div');
            if (targetNode) {
                targetNode.innerText = `$${totalCashSales.toFixed(2)}`;
            }
        }

    }).catch((error) => {
        console.error("خطأ في حساب حركة الصندوق: ", error);
    });
}

// دوائر مساعد للبحث عن العناصر في الواجهة وتحديثها ديناميكياً بدون تعديل HTML
function updateCardValueByText(headerText, valueText) {
    const elements = document.querySelectorAll('*');
    elements.forEach(el => {
        if (el.childNodes.length === 1 && el.textContent.trim() === headerText) {
            // العثور على العنصر الأب أو الحقل التالي الذي يحمل السعر ($0.00)
            let parentBox = el.closest('div');
            if (parentBox) {
                // البحث عن عنصر يحمل علامة الدولار أو رقم داخل الصندوق
                let valNode = parentBox.querySelector('div:not(:first-child), h3, span, b');
                if (valNode && (valNode.textContent.includes('$') || valNode.textContent.includes('0.00'))) {
                    valNode.innerText = valueText;
                }
            }
        }
    });
}

function findElementContainingText(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeValue.includes(text)) {
            return node.parentElement;
        }
    }
    return null;
}

// ربط تغيير تاريخ الفلترة في تبويب الصندوق بتحديث الحسابات
document.addEventListener("DOMContentLoaded", () => {
    const cashDateFilter = document.getElementById('cashDateFilter');
    if (cashDateFilter) {
        cashDateFilter.addEventListener('change', calculateCashflow);
    }
});

// ----------------- جلب الأرشيف والبيانات من السحابة (الدالة الموحدة) -----------------
function loadInvoices() {
    const archiveContainer = document.getElementById('fullArchiveList');
    
    invoicesCollection.get().then((querySnapshot) => {
        let invoicesList = [];
        querySnapshot.forEach((doc) => {
            invoicesList.push({ firebaseId: doc.id, ...doc.data() });
        });

        // تحديث حركة الصندوق اليومية فور جلب وتحديث الفواتير
        calculateCashflow();

        // 1. عرض الأرشيف
        if (archiveContainer) {
            if (invoicesList.length === 0) {
                archiveContainer.innerHTML = "<p style='padding:10px; color:#666;'>لا توجد فواتير مسجلة حتى الآن.</p>";
            } else {
                let tableHTML = `
                    <table class="items-table" style="width:100%; margin-top:10px; border-collapse: collapse; background:#fff;">
                        <thead>
                            <tr style="background:#f2f2f2;">
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">رقم الدور</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">المقلع</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">التاريخ</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">اسم الزبون</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">السائق</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">المواد والكميات</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">الإجمالي ($)</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:right;">حالة الدفع</th>
                                <th style="padding:10px; border:1px solid #ddd; text-align:center;">إجراء</th>
                            </tr>
                        </thead>
                        <tbody>
                `;

                invoicesList.slice().reverse().forEach((inv) => {
                    const amount = Number(inv.grandTotal || 0);
                    let itemsSummary = (inv.items && Array.isArray(inv.items)) ? inv.items.map(i => `${i.name}: ${i.qty}م3 × ${i.price}$`).join(' | ') : '';
                    
                    tableHTML += `
                        <tr>
                            <td style="padding:10px; border:1px solid #ddd;"><span style="background:#2c3e50; color:white; padding:2px 6px; border-radius:3px;">A-${inv.turnNumber || inv.queueNumber || 1}</span></td>
                            <td style="padding:10px; border:1px solid #ddd; color:#2980b9;"><b>${inv.quarryName || '---'}</b></td>
                            <td style="padding:10px; border:1px solid #ddd;">${inv.date || '---'}</td>
                            <td style="padding:10px; border:1px solid #ddd;"><b>${inv.customerName || '---'}</b></td>
                            <td style="padding:10px; border:1px solid #ddd;">${inv.carNumber || '---'}</td>
                            <td style="padding:10px; border:1px solid #ddd;">${itemsSummary}</td>
                            <td style="padding:10px; border:1px solid #ddd; font-weight:bold; color:#27ae60;">$${amount.toFixed(2)}</td>
                            <td style="padding:10px; border:1px solid #ddd; color:${inv.paymentStatus === 'دين' ? 'red' : 'green'}; font-weight:bold;">${inv.paymentStatus || '---'}</td>
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

        // 2. تحديث جدول إحصاء المواد المباعة
        const materialsBody = document.getElementById('materialsStatsBody');
        if (materialsBody) {
            let materialsMap = {};
            invoicesList.forEach(inv => {
                if (inv.items && Array.isArray(inv.items)) {
                    inv.items.forEach(item => {
                        let name = item.name || 'مادة عامة';
                        let qty = Number(item.qty || 0);
                        let total = Number(item.total || 0);
                        if (!materialsMap[name]) materialsMap[name] = { qty: 0, total: 0 };
                        materialsMap[name].qty += qty;
                       materialsMap[name].total += total;
                    });
                }
            });

            let matHtml = '';
            for (let mat in materialsMap) {
                matHtml += `
                    <tr>
                        <td style="padding:8px; border:1px solid #ddd;"><b>${mat}</b></td>
                        <td style="padding:8px; border:1px solid #ddd; color:#2980b9;"><b>${materialsMap[mat].qty.toFixed(2)} م3</b></td>
                        <td style="padding:8px; border:1px solid #ddd;"><b>${materialsMap[mat].total.toFixed(2)} $</b></td>
                    </tr>
                `;
            }
            if (matHtml === '') {
                matHtml = '<tr><td colspan="3" style="text-align:center; padding:10px; color:#666;">لا توجد مواد مسجلة حتى الآن</td></tr>';
            }
            materialsBody.innerHTML = matHtml;
      }

    }).catch((error) => {
        console.error("خطأ في جلب البيانات من السحابة: ", error);
    });
}

// دالة حذف الفاتورة نهائياً من سحابة Firebase
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

// التشغيل التلقائي عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
    attachEventsToRows();
    loadInvoices();
});
