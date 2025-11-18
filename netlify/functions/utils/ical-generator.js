function formatICalDate(dateStr, timeStr) {
    const date = new Date(dateStr);
    
    if (timeStr) {
        const [hours, minutes] = timeStr.split(':');
        date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    } else {
        date.setHours(0, 0, 0, 0);
    }
    
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function generateICalContent(event) {
    const { Name, Date: eventDate, Time: eventTime, Description, Location } = event.fields;
    
    if (!eventDate) {
        throw new Error('Event date is required for iCal generation');
    }
    
    const startDate = formatICalDate(eventDate, eventTime);
    
    const endDate = new Date(eventDate);
    if (eventTime) {
        const [hours, minutes] = eventTime.split(':');
        endDate.setHours(parseInt(hours, 10) + 2, parseInt(minutes, 10), 0, 0);
    } else {
        endDate.setHours(23, 59, 59, 999);
    }
    const formattedEndDate = endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const uid = `${event.id}@whatthefunfinder.com`;
    
    const escapedName = (Name || 'Event').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const escapedDescription = (Description || '').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const escapedLocation = (Location || '').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    
    const icalContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//WhatTheFunFinder//Event//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART:${startDate}`,
        `DTEND:${formattedEndDate}`,
        `SUMMARY:${escapedName}`,
        escapedDescription ? `DESCRIPTION:${escapedDescription}` : '',
        escapedLocation ? `LOCATION:${escapedLocation}` : '',
        'STATUS:CONFIRMED',
        'SEQUENCE:0',
        'END:VEVENT',
        'END:VCALENDAR'
    ].filter(line => line).join('\r\n');
    
    return icalContent;
}

function generateCalendarLinks(event, siteUrl) {
    const { Name, Date: eventDate, Time: eventTime, Description, Location } = event.fields;
    
    if (!eventDate) {
        return {};
    }
    
    const eventName = encodeURIComponent(Name || 'Event');
    const eventDesc = encodeURIComponent(Description || '');
    const eventLoc = encodeURIComponent(Location || '');
    
    const startDate = new Date(eventDate);
    if (eventTime) {
        const [hours, minutes] = eventTime.split(':');
        startDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    }
    
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 2);
    
    const formatGoogleDate = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const googleStart = formatGoogleDate(startDate);
    const googleEnd = formatGoogleDate(endDate);
    
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${eventName}&dates=${googleStart}/${googleEnd}&details=${eventDesc}&location=${eventLoc}`;
    
    const outlookStart = startDate.toISOString();
    const outlookEnd = endDate.toISOString();
    const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${eventName}&startdt=${outlookStart}&enddt=${outlookEnd}&body=${eventDesc}&location=${eventLoc}`;
    
    const yahooStart = formatGoogleDate(startDate);
    const yahooEnd = formatGoogleDate(endDate);
    const duration = Math.floor((endDate - startDate) / (1000 * 60 * 60)).toString().padStart(2, '0') + 
                     Math.floor(((endDate - startDate) % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
    const yahooUrl = `https://calendar.yahoo.com/?v=60&view=d&type=20&title=${eventName}&st=${yahooStart}&dur=${duration}&desc=${eventDesc}&in_loc=${eventLoc}`;
    
    return {
        google: googleCalendarUrl,
        outlook: outlookUrl,
        yahoo: yahooUrl,
        ical: `${siteUrl}/.netlify/functions/download-ical?eventId=${event.id}`
    };
}

module.exports = {
    generateICalContent,
    generateCalendarLinks
};
