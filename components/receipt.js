import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import { getRecordPrice, getEffectiveMinQuantity } from '../utils.js';
import { log } from '../utils/debug.js';

export function showReceiptModal(paymentIndex) {
    log('Receipt', `Opening receipt in new window for payment index ${paymentIndex}`);
    
    const paymentHistory = state.session.user.paymentHistory || [];
    
    if (paymentIndex < 0 || paymentIndex >= paymentHistory.length) {
        console.error('Invalid payment index:', paymentIndex);
        return;
    }
    
    const payment = paymentHistory[paymentIndex];
    
    // Sort payments by date to get the chronological order
    const sortedPayments = paymentHistory
        .map((p, originalIndex) => ({ ...p, originalIndex }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Find the display index (chronological position) of the current payment
    const displayIndex = sortedPayments.findIndex(p => p.originalIndex === paymentIndex);
    
    const receiptNumber = `${state.session.id.substring(0, 8).toUpperCase()}-${displayIndex + 1}`;
    const paymentDate = new Date(payment.date);
    const formattedDate = paymentDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Untitled Event';

    // Check if UMW is in plan
    let isUmwInPlan = false;
    for (const [id] of state.cart.lockedItems) {
        const lockedRecord = state.records.all.find(r => r.id === id);
        if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
            isUmwInPlan = true;
            break;
        }
    }

    let itemsHtml = '';
    let itemsSubtotal = 0;
    
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        // Use selections if available, otherwise fall back to selectedOptionIndex
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;
        const unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
        const quantity = itemInfo.quantity || 1;
        const itemTotal = unitPrice * quantity;
        itemsSubtotal += itemTotal;

        // Check for edge case notes
        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveMin = getEffectiveMinQuantity(record);
        let edgeCaseNote = '';

        if (airtableMin > 1) {
            if (!isUmwInPlan && quantity === effectiveMin) {
                // Off-site at minimum
                edgeCaseNote = '<br><small style="color: #fd7e14; font-style: italic;">* At minimum headcount for off-site event</small>';
            } else if (isUmwInPlan && quantity < airtableMin) {
                // On-site below standard minimum
                edgeCaseNote = '<br><small style="color: #28a745; font-style: italic;">✓ Below standard minimum (Union Machine Works venue)</small>';
            }
        }

        itemsHtml += `
            <tr>
                <td>${record.fields.Name}${edgeCaseNote}</td>
                <td style="text-align: center;">${quantity}</td>
                <td style="text-align: right;">$${unitPrice.toFixed(2)}</td>
                <td style="text-align: right;">$${itemTotal.toFixed(2)}</td>
            </tr>
        `;
    }
    
    // Calculate previous payments (those that came before this one chronologically)
    let previousPaymentsTotal = 0;
    const previousPayments = [];
    for (let i = 0; i < displayIndex; i++) {
        previousPaymentsTotal += sortedPayments[i].amount;
        previousPayments.push(sortedPayments[i]);
    }
    
    const isFullPayment = payment.amount >= itemsSubtotal;
    const paymentTypeLabel = isFullPayment ? 'Full Payment' : 
                             (displayIndex === 0 ? 'Deposit (35%)' : 'Partial Payment');
    
    const receiptHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Receipt #${receiptNumber}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            padding: 40px 20px;
            background-color: #f5f5f5;
            color: #333;
        }
        .receipt-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .receipt-header {
            text-align: center;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .receipt-header h1 {
            font-size: 32px;
            margin-bottom: 10px;
        }
        .receipt-number {
            font-size: 14px;
            color: #666;
            font-weight: 600;
        }
        .receipt-info {
            margin-bottom: 30px;
        }
        .receipt-info-row {
            display: flex;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .receipt-info-row .label {
            font-weight: 600;
            width: 150px;
        }
        .receipt-info-row .value {
            flex: 1;
        }
        .receipt-items {
            margin-bottom: 30px;
        }
        .receipt-items h2 {
            font-size: 20px;
            margin-bottom: 15px;
        }
        .receipt-table {
            width: 100%;
            border-collapse: collapse;
        }
        .receipt-table th,
        .receipt-table td {
            padding: 12px;
            border-bottom: 1px solid #eee;
        }
        .receipt-table th {
            background-color: #f8f9fa;
            font-weight: 600;
            text-align: left;
        }
        .receipt-totals {
            border-top: 2px solid #333;
            padding-top: 20px;
            margin-bottom: 30px;
        }
        .receipt-total-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 16px;
        }
        .receipt-total-row.payment-amount {
            font-size: 20px;
            font-weight: bold;
            color: #28a745;
            border-top: 2px solid #ddd;
            padding-top: 15px;
            margin-top: 10px;
        }
        .receipt-note {
            margin-top: 15px;
            padding: 15px;
            background-color: #f8f9fa;
            border-left: 3px solid #007bff;
            font-style: italic;
        }
        .receipt-footer {
            text-align: center;
            padding-top: 30px;
            border-top: 2px solid #333;
        }
        .receipt-footer p {
            font-size: 18px;
            margin-bottom: 20px;
        }
        .print-button {
            background-color: #007bff;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
            margin-right: 10px;
        }
        .print-button:hover {
            background-color: #0056b3;
        }
        .close-button {
            background-color: #6c757d;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
        }
        .close-button:hover {
            background-color: #545b62;
        }
        .previous-payments-section {
            margin-top: 15px;
            padding: 15px;
            background-color: #e7f3ff;
            border-left: 3px solid #007bff;
        }
        .previous-payments-section h3 {
            font-size: 16px;
            margin-bottom: 10px;
            color: #0056b3;
        }
        .previous-payment-item {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
            font-size: 14px;
        }
        .view-receipt-link {
            color: #007bff;
            text-decoration: underline;
            cursor: pointer;
            font-size: 14px;
            background: none;
            border: none;
            padding: 0;
            margin-left: 10px;
        }
        .view-receipt-link:hover {
            color: #0056b3;
        }
        @media print {
            body {
                background-color: white;
                padding: 0;
            }
            .receipt-container {
                box-shadow: none;
                padding: 20px;
            }
            .print-button,
            .close-button,
            .view-receipt-link {
                display: none;
            }
        }
    </style>
    <script>
        function openEarlierReceipt(originalIndex) {
            // Call the parent window's showReceiptModal function
            if (window.opener && window.opener.showReceiptModal) {
                window.opener.showReceiptModal(originalIndex);
            }
        }
    </script>
</head>
<body>
    <div class="receipt-container">
        <div class="receipt-header">
            <h1>Payment Receipt</h1>
            <div class="receipt-number">Receipt #${receiptNumber}</div>
        </div>
        
        <div class="receipt-info">
            <div class="receipt-info-row">
                <span class="label">Event:</span>
                <span class="value">${eventName}</span>
            </div>
            <div class="receipt-info-row">
                <span class="label">Payment Date:</span>
                <span class="value">${formattedDate}</span>
            </div>
            <div class="receipt-info-row">
                <span class="label">Payment Type:</span>
                <span class="value">${paymentTypeLabel}</span>
            </div>
        </div>
        
        <div class="receipt-items">
            <h2>Plan Items</h2>
            <table class="receipt-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th style="text-align: center;">Qty</th>
                        <th style="text-align: right;">Unit Price</th>
                        <th style="text-align: right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
        </div>
        
        <div class="receipt-totals">
            <div class="receipt-total-row">
                <span class="label">Plan Subtotal:</span>
                <span class="value">$${itemsSubtotal.toFixed(2)}</span>
            </div>
            ${previousPaymentsTotal > 0 ? `
            <div class="receipt-total-row">
                <span class="label">Previous Payments:</span>
                <span class="value">-$${previousPaymentsTotal.toFixed(2)}</span>
            </div>
            <div class="receipt-total-row">
                <span class="label">Subtotal After Previous Payments:</span>
                <span class="value">$${(itemsSubtotal - previousPaymentsTotal).toFixed(2)}</span>
            </div>
            ` : ''}
            <div class="receipt-total-row payment-amount">
                <span class="label">Payment Amount:</span>
                <span class="value">$${payment.amount.toFixed(2)}</span>
            </div>
            ${payment.note ? `<div class="receipt-note">${payment.note}</div>` : ''}
            ${previousPayments.length > 0 ? `
            <div class="previous-payments-section">
                <h3>Previous Payments:</h3>
                ${previousPayments.map((prevPayment, idx) => {
                    const prevPaymentDate = new Date(prevPayment.date).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric' 
                    });
                    return `
                    <div class="previous-payment-item">
                        <span>Payment ${idx + 1} - ${prevPaymentDate}: $${prevPayment.amount.toFixed(2)}</span>
                        <button class="view-receipt-link" onclick="openEarlierReceipt(${prevPayment.originalIndex})">View Receipt</button>
                    </div>`;
                }).join('')}
            </div>
            ` : ''}
        </div>
        
        <div class="receipt-footer">
            <p>Thank you for your payment!</p>
            <button onclick="window.print()" class="print-button">Print Receipt</button>
            <button onclick="window.close()" class="close-button">Close Window</button>
        </div>
    </div>
</body>
</html>
    `;
    
    const receiptWindow = window.open('', '_blank', 'width=900,height=800,menubar=no,toolbar=no,location=no,status=no');
    
    if (receiptWindow) {
        receiptWindow.document.write(receiptHtml);
        receiptWindow.document.close();
        receiptWindow.focus();
    } else {
        console.error('Failed to open receipt window. Pop-up may have been blocked.');
        alert('Please allow pop-ups for this site to view receipts.');
    }
}

export function hideReceiptModal() {
    const receiptOverlay = document.getElementById('receipt-modal-overlay');
    if (receiptOverlay) {
        receiptOverlay.classList.remove('active');
        setTimeout(() => {
            receiptOverlay.style.display = 'none';
        }, 300);
        document.body.classList.remove('modal-open');
    }
}
