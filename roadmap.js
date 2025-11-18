const statusToColumnMap = {
    'Backlog': 'col-backlog',
    'Next Up': 'col-next-up',
    'In Progress': 'col-in-progress',
    'Completed': 'col-completed'
};

let currentEditingRecordId = null;

function initializeRoadmap() {
    console.log('[Roadmap] Initializing...');
    
    fetchAndRenderBoard();
    
    document.getElementById('submit-idea-form').addEventListener('submit', handleIdeaSubmit);
    document.getElementById('ai-suggest-features-btn').addEventListener('click', handleSuggestClick);
    
    const modal = document.getElementById('edit-modal');
    const closeButtons = document.querySelectorAll('.close-modal');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    document.getElementById('edit-feature-form').addEventListener('submit', handleEditSubmit);
}

async function fetchAndRenderBoard() {
    console.log('[Roadmap] Fetching features...');
    
    try {
        const response = await fetch('/api/roadmap-get-features');
        if (!response.ok) {
            throw new Error(`Failed to fetch features: ${response.status}`);
        }
        
        const features = await response.json();
        console.log(`[Roadmap] Fetched ${features.length} features`);
        
        Object.values(statusToColumnMap).forEach(colId => {
            document.getElementById(colId).innerHTML = '';
        });
        
        features.forEach(feature => {
            renderFeatureCard(feature);
        });
        
    } catch (error) {
        console.error('[Roadmap] Error fetching features:', error);
        alert('Failed to load features. Please refresh the page.');
    }
}

function renderFeatureCard(feature) {
    const status = feature.fields.Status || 'Backlog';
    const columnId = statusToColumnMap[status];
    
    if (!columnId) {
        console.warn(`[Roadmap] Unknown status: ${status}`);
        return;
    }
    
    const column = document.getElementById(columnId);
    
    const card = document.createElement('div');
    card.className = 'feature-card';
    card.dataset.recordId = feature.id;
    
    const title = document.createElement('div');
    title.className = 'feature-card-title';
    title.textContent = feature.fields.Feature || 'Untitled';
    
    const desc = document.createElement('div');
    desc.className = 'feature-card-desc';
    desc.textContent = feature.fields.Description || '';
    
    const metaContainer = document.createElement('div');
    metaContainer.className = 'feature-card-meta';
    
    if (feature.fields.Priority) {
        const priorityTag = document.createElement('span');
        priorityTag.className = 'meta-tag';
        priorityTag.textContent = `Priority: ${feature.fields.Priority}`;
        metaContainer.appendChild(priorityTag);
    }
    
    if (feature.fields.Effort) {
        const effortTag = document.createElement('span');
        effortTag.className = 'meta-tag';
        effortTag.textContent = `Effort: ${feature.fields.Effort}`;
        metaContainer.appendChild(effortTag);
    }
    
    if (feature.fields.Goal_Alignment && feature.fields.Goal_Alignment.length > 0) {
        feature.fields.Goal_Alignment.forEach(goal => {
            const goalTag = document.createElement('span');
            goalTag.className = 'meta-tag';
            goalTag.textContent = goal;
            metaContainer.appendChild(goalTag);
        });
    }
    
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(metaContainer);
    
    if (status === 'Backlog') {
        const analyzeBtn = document.createElement('button');
        analyzeBtn.className = 'analyze-btn';
        analyzeBtn.textContent = '🤖 Analyze';
        analyzeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleAnalyzeClick(feature.id, feature.fields.Feature, feature.fields.Description);
        });
        card.appendChild(analyzeBtn);
    }
    
    card.addEventListener('click', () => {
        openEditModal(feature);
    });
    
    column.appendChild(card);
}

async function handleIdeaSubmit(event) {
    event.preventDefault();
    
    const featureName = document.getElementById('new-feature-name').value.trim();
    const featureDesc = document.getElementById('new-feature-desc').value.trim();
    
    if (!featureName || !featureDesc) {
        alert('Please fill in both fields');
        return;
    }
    
    console.log('[Roadmap] Submitting new idea:', featureName);
    
    try {
        const response = await fetch('/api/roadmap-create-feature', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                feature: featureName,
                description: featureDesc
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create feature: ${response.status}`);
        }
        
        document.getElementById('new-feature-name').value = '';
        document.getElementById('new-feature-desc').value = '';
        
        await fetchAndRenderBoard();
        
        console.log('[Roadmap] Feature created successfully');
        
    } catch (error) {
        console.error('[Roadmap] Error creating feature:', error);
        alert('Failed to create feature. Please try again.');
    }
}

async function handleAnalyzeClick(recordId, featureName, featureDescription) {
    console.log('[Roadmap] Analyzing feature:', featureName);
    
    const card = document.querySelector(`[data-record-id="${recordId}"]`);
    const analyzeBtn = card.querySelector('.analyze-btn');
    const originalText = analyzeBtn.textContent;
    analyzeBtn.textContent = 'Analyzing...';
    analyzeBtn.disabled = true;
    
    try {
        const response = await fetch('/api/ai-team-prioritizer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                featureName: featureName,
                featureDescription: featureDescription
            })
        });
        
        if (!response.ok) {
            throw new Error(`AI analysis failed: ${response.status}`);
        }
        
        const aiData = await response.json();
        console.log('[Roadmap] AI analysis result:', aiData);
        
        const updateResponse = await fetch('/api/roadmap-update-feature', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recordId: recordId,
                fields: {
                    Goal_Alignment: aiData.Goal_Alignment,
                    Effort: aiData.Effort
                }
            })
        });
        
        if (!updateResponse.ok) {
            throw new Error(`Failed to update feature: ${updateResponse.status}`);
        }
        
        await fetchAndRenderBoard();
        
        console.log('[Roadmap] Feature analyzed and updated successfully');
        
    } catch (error) {
        console.error('[Roadmap] Error analyzing feature:', error);
        alert('Failed to analyze feature. Please try again.');
        analyzeBtn.textContent = originalText;
        analyzeBtn.disabled = false;
    }
}

async function handleSuggestClick() {
    console.log('[Roadmap] Requesting AI feature suggestions...');
    
    const statusDiv = document.getElementById('ai-panel-status');
    const btn = document.getElementById('ai-suggest-features-btn');
    
    statusDiv.textContent = '🤔 Thinking...';
    btn.disabled = true;
    
    try {
        const response = await fetch('/api/ai-team-ideator');
        
        if (!response.ok) {
            throw new Error(`AI ideation failed: ${response.status}`);
        }
        
        const ideas = await response.json();
        console.log('[Roadmap] AI suggested', ideas.length, 'ideas');
        
        statusDiv.textContent = `💡 Creating ${ideas.length} new ideas...`;
        
        for (const idea of ideas) {
            await fetch('/api/roadmap-create-feature', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    feature: idea.feature,
                    description: idea.description
                })
            });
        }
        
        await fetchAndRenderBoard();
        
        statusDiv.textContent = `✅ Added ${ideas.length} new ideas to backlog!`;
        setTimeout(() => {
            statusDiv.textContent = 'Ready to generate ideas...';
            btn.disabled = false;
        }, 3000);
        
    } catch (error) {
        console.error('[Roadmap] Error generating suggestions:', error);
        statusDiv.textContent = '❌ Failed to generate ideas. Try again.';
        btn.disabled = false;
    }
}

function openEditModal(feature) {
    currentEditingRecordId = feature.id;
    
    document.getElementById('edit-record-id').value = feature.id;
    document.getElementById('edit-feature-name').value = feature.fields.Feature || '';
    document.getElementById('edit-description').value = feature.fields.Description || '';
    document.getElementById('edit-status').value = feature.fields.Status || 'Backlog';
    document.getElementById('edit-priority').value = feature.fields.Priority || '';
    document.getElementById('edit-effort').value = feature.fields.Effort || '';
    document.getElementById('edit-notes').value = feature.fields.Notes || '';
    
    document.getElementById('edit-modal').style.display = 'block';
}

async function handleEditSubmit(event) {
    event.preventDefault();
    
    const recordId = document.getElementById('edit-record-id').value;
    const updatedFields = {
        Feature: document.getElementById('edit-feature-name').value,
        Description: document.getElementById('edit-description').value,
        Status: document.getElementById('edit-status').value,
        Priority: document.getElementById('edit-priority').value || null,
        Effort: document.getElementById('edit-effort').value || null,
        Notes: document.getElementById('edit-notes').value || null
    };
    
    console.log('[Roadmap] Updating feature:', recordId);
    
    try {
        const response = await fetch('/api/roadmap-update-feature', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recordId: recordId,
                fields: updatedFields
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to update feature: ${response.status}`);
        }
        
        document.getElementById('edit-modal').style.display = 'none';
        await fetchAndRenderBoard();
        
        console.log('[Roadmap] Feature updated successfully');
        
    } catch (error) {
        console.error('[Roadmap] Error updating feature:', error);
        alert('Failed to update feature. Please try again.');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeRoadmap);
} else {
    initializeRoadmap();
}
