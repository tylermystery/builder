/**
 * Calendar Export Utilities
 * Provides functions to export events to various calendar formats
 */

/**
 * Formats a date for iCal format (YYYYMMDDTHHMMSSZ)
 * @param {string|Date} date - Date to format
 * @param {string} time - Time string (e.g., "7:00 PM")
 * @returns {string} Formatted iCal date string
 */
function formatICalDate(date, time = null) {
  let dateObj;

  if (typeof date === 'string') {
    // Parse date in local timezone to avoid timezone conversion issues
    dateObj = new Date(date + 'T00:00:00');
  } else {
    dateObj = new Date(date);
  }

  // If time is provided, parse and set it
  if (time) {
    const timeParts = parseTime(time);
    if (timeParts) {
      dateObj.setHours(timeParts.hours, timeParts.minutes, 0, 0);
    }
  } else {
    // Default to 11:00 AM if no time is provided
    dateObj.setHours(11, 0, 0, 0);
  }

  // Format as iCal date: YYYYMMDDTHHMMSSZ
  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getUTCDate()).padStart(2, '0');
  const hours = String(dateObj.getUTCHours()).padStart(2, '0');
  const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
  const seconds = String(dateObj.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Parse time string to hours and minutes
 * @param {string} timeStr - Time string (e.g., "7:00 PM", "14:30")
 * @returns {Object|null} Object with hours and minutes, or null if invalid
 */
function parseTime(timeStr) {
  if (!timeStr) return null;

  // Handle formats like "7:00 PM" or "14:30"
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  // Convert to 24-hour format if PM
  if (meridiem === 'PM' && hours !== 12) {
    hours += 12;
  } else if (meridiem === 'AM' && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
}

/**
 * Calculate end date based on duration
 * @param {Date} startDate - Start date
 * @param {number} durationHours - Duration in hours (defaults to 8 hours: 11 AM to 7 PM)
 * @returns {Date} End date
 */
function calculateEndDate(startDate, durationHours = 8) {
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + durationHours);
  return endDate;
}

/**
 * Escape special characters for iCal format
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeICalText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Generate iCal file content
 * @param {Object} event - Event record from Airtable
 * @returns {string} iCal file content
 */
function generateICalFile(event) {
  const fields = event.fields || event;

  const title = escapeICalText(fields.Name || 'Event');
  const description = escapeICalText(fields.Description || '');
  const location = escapeICalText(fields['Location Details'] || '');
  const date = fields.Date;
  const time = fields.Time;
  // If no time provided, use 8 hours (11 AM to 7 PM); otherwise use Duration field or 2 hours default
  const duration = time ? (fields['Duration (hours)'] || 2) : 8;

  // Create start date in local timezone
  const startDate = new Date(date + 'T00:00:00');
  if (time) {
    const timeParts = parseTime(time);
    if (timeParts) {
      startDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
    }
  } else {
    // Default to 11:00 AM if no time is provided
    startDate.setHours(11, 0, 0, 0);
  }

  // Calculate end date
  const endDate = calculateEndDate(startDate, duration);

  // Format dates for iCal
  const dtStart = formatICalDate(startDate);
  const dtEnd = formatICalDate(endDate);
  const dtStamp = formatICalDate(new Date());

  // Generate unique ID
  const uid = `${event.id || Date.now()}@whatthefun.com`;

  // Build iCal content
  const icalContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//What The Fun//Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  return icalContent;
}

/**
 * Download iCal file
 * @param {Object} event - Event record from Airtable
 */
function downloadICalFile(event) {
  const icalContent = generateICalFile(event);
  const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${(event.fields?.Name || 'event').replace(/[^a-z0-9]/gi, '_')}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Generate Google Calendar URL
 * @param {Object} event - Event record from Airtable
 * @returns {string} Google Calendar URL
 */
function generateGoogleCalendarUrl(event) {
  const fields = event.fields || event;

  const title = encodeURIComponent(fields.Name || 'Event');
  const description = encodeURIComponent(fields.Description || '');
  const location = encodeURIComponent(fields['Location Details'] || '');
  const date = fields.Date;
  const time = fields.Time;
  // If no time provided, use 8 hours (11 AM to 7 PM); otherwise use Duration field or 2 hours default
  const duration = time ? (fields['Duration (hours)'] || 2) : 8;

  // Create start date in local timezone
  const startDate = new Date(date + 'T00:00:00');
  if (time) {
    const timeParts = parseTime(time);
    if (timeParts) {
      startDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
    }
  } else {
    // Default to 11:00 AM if no time is provided
    startDate.setHours(11, 0, 0, 0);
  }

  // Calculate end date
  const endDate = calculateEndDate(startDate, duration);

  // Format dates for Google Calendar (YYYYMMDDTHHmmss)
  const formatGoogleDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  };

  const dates = `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`;

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${description}&location=${location}`;
}

/**
 * Generate Outlook Calendar URL
 * @param {Object} event - Event record from Airtable
 * @returns {string} Outlook Calendar URL
 */
function generateOutlookCalendarUrl(event) {
  const fields = event.fields || event;

  const title = encodeURIComponent(fields.Name || 'Event');
  const description = encodeURIComponent(fields.Description || '');
  const location = encodeURIComponent(fields['Location Details'] || '');
  const date = fields.Date;
  const time = fields.Time;
  // If no time provided, use 8 hours (11 AM to 7 PM); otherwise use Duration field or 2 hours default
  const duration = time ? (fields['Duration (hours)'] || 2) : 8;

  // Create start date in local timezone
  const startDate = new Date(date + 'T00:00:00');
  if (time) {
    const timeParts = parseTime(time);
    if (timeParts) {
      startDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
    }
  } else {
    // Default to 11:00 AM if no time is provided
    startDate.setHours(11, 0, 0, 0);
  }

  // Calculate end date
  const endDate = calculateEndDate(startDate, duration);

  // Format dates for Outlook (ISO 8601)
  const startTime = startDate.toISOString();
  const endTime = endDate.toISOString();

  return `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&body=${description}&location=${location}&startdt=${startTime}&enddt=${endTime}&path=/calendar/action/compose&rru=addevent`;
}

/**
 * Generate Yahoo Calendar URL
 * @param {Object} event - Event record from Airtable
 * @returns {string} Yahoo Calendar URL
 */
function generateYahooCalendarUrl(event) {
  const fields = event.fields || event;

  const title = encodeURIComponent(fields.Name || 'Event');
  const description = encodeURIComponent(fields.Description || '');
  const location = encodeURIComponent(fields['Location Details'] || '');
  const date = fields.Date;
  const time = fields.Time;
  // If no time provided, use 8 hours (11 AM to 7 PM); otherwise use Duration field or 2 hours default
  const duration = time ? (fields['Duration (hours)'] || 2) : 8;

  // Create start date in local timezone
  const startDate = new Date(date + 'T00:00:00');
  if (time) {
    const timeParts = parseTime(time);
    if (timeParts) {
      startDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
    }
  } else {
    // Default to 11:00 AM if no time is provided
    startDate.setHours(11, 0, 0, 0);
  }

  // Calculate end date
  const endDate = calculateEndDate(startDate, duration);

  // Format dates for Yahoo (YYYYMMDDTHHmmss)
  const formatYahooDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  };

  const st = formatYahooDate(startDate);
  const et = formatYahooDate(endDate);

  // Calculate duration for Yahoo (in hours and minutes)
  const durationMinutes = Math.round((endDate - startDate) / 1000 / 60);
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const dur = `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;

  return `https://calendar.yahoo.com/?v=60&title=${title}&st=${st}&dur=${dur}&desc=${description}&in_loc=${location}`;
}

/**
 * Open calendar export in new window/tab
 * @param {string} url - Calendar URL
 */
function openCalendarUrl(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Create calendar export buttons HTML
 * @param {Object} event - Event record from Airtable
 * @returns {string} HTML for calendar export buttons
 */
function createCalendarExportButtons(event) {
  // Only show for events with dates
  if (!event.fields?.Date) {
    return '';
  }

  return `
    <div class="calendar-export-container">
      <div class="calendar-export-label">Add to Calendar:</div>
      <div class="calendar-export-buttons">
        <button class="calendar-export-btn google-calendar-btn" data-calendar="google" title="Add to Google Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/>
          </svg>
          Google
        </button>
        <button class="calendar-export-btn outlook-calendar-btn" data-calendar="outlook" title="Add to Outlook Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
          </svg>
          Outlook
        </button>
        <button class="calendar-export-btn apple-calendar-btn" data-calendar="apple" title="Add to Apple Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          Apple
        </button>
        <button class="calendar-export-btn yahoo-calendar-btn" data-calendar="yahoo" title="Add to Yahoo Calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V8l7 4.5L19 8v10z"/>
          </svg>
          Yahoo
        </button>
        <button class="calendar-export-btn ical-download-btn" data-calendar="ical" title="Download iCal file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z"/>
          </svg>
          Download
        </button>
      </div>
    </div>
  `;
}

/**
 * Initialize calendar export event listeners
 * @param {Object} event - Event record from Airtable
 * @param {HTMLElement} container - Container element with calendar buttons
 */
function initializeCalendarExportListeners(event, container) {
  if (!container) return;

  const buttons = container.querySelectorAll('.calendar-export-btn');

  buttons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const calendarType = button.getAttribute('data-calendar');

      switch (calendarType) {
        case 'google':
          openCalendarUrl(generateGoogleCalendarUrl(event));
          break;
        case 'outlook':
          openCalendarUrl(generateOutlookCalendarUrl(event));
          break;
        case 'apple':
          // Apple Calendar uses iCal files
          downloadICalFile(event);
          break;
        case 'yahoo':
          openCalendarUrl(generateYahooCalendarUrl(event));
          break;
        case 'ical':
          downloadICalFile(event);
          break;
      }
    });
  });
}

// ES6 Module Exports (for import statements)
export {
  generateICalFile,
  downloadICalFile,
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  openCalendarUrl,
  createCalendarExportButtons,
  initializeCalendarExportListeners
};

// CommonJS Export (for Node.js compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateICalFile,
    downloadICalFile,
    generateGoogleCalendarUrl,
    generateOutlookCalendarUrl,
    generateYahooCalendarUrl,
    openCalendarUrl,
    createCalendarExportButtons,
    initializeCalendarExportListeners
  };
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.calendarExport = {
    generateICalFile,
    downloadICalFile,
    generateGoogleCalendarUrl,
    generateOutlookCalendarUrl,
    generateYahooCalendarUrl,
    openCalendarUrl,
    createCalendarExportButtons,
    initializeCalendarExportListeners
  };
}
