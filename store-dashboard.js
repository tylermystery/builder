// In store-dashboard.js
async function initializeDashboard() {
    const urlParams = new URLSearchParams(window.location.search);
    const ownerId = urlParams.get('id');

    if (!ownerId) {
        document.body.innerHTML = '<h1>Error: No dashboard ID provided.</h1>';
        return;
    }

    try {
        const response = await fetch(`/api/get-store-data-by-owner-id?id=${ownerId}`);
        if (!response.ok) {
            throw new Error('Could not load store data.');
        }
        const { store, items } = await response.json();
        
        document.getElementById('store-name-header').textContent = `${store.fields.Name} Dashboard`;
        document.getElementById('store-settings-container').textContent = 'Settings form will go here.';
        
        let itemsHtml = items.map(item => `<div>${item.fields.Name}</div>`).join('');
        document.getElementById('item-list-container').innerHTML = `<ul>${itemsHtml}</ul>`;
    } catch (error) {
        document.body.innerHTML = `<h1>Error: ${error.message}</h1>`;
    }
}

initializeDashboard();
