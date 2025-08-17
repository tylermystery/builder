// src/components/ItemCard.js

import React from 'react';
import '../styles/ItemCard.css';

// --- Mock Components for standalone functionality ---
// In your actual app, you would import these from their own files.
const EditButton = () => <button className="action-btn">Edit</button>;
const HeartButton = () => <button className="action-btn">❤️</button>;
const EmojiReactPanel = () => <div className="emoji-panel">😀👍🎉</div>;
// --- End Mock Components ---

/**
 * A card component that displays a summary of an item.
 * It includes a header with name and price, a body for description,
 * and a footer with a standardized action toolbar.
 */
const ItemCard = ({ item = {} }) => {
  return (
    <div className="item-card">
      <div className="item-card-header">
        <h3>{item.name || "Sample Item Name"}</h3>
        <span>${item.price || "99.99"}</span>
      </div>

      <div className="item-card-body">
        <p>{item.description || "This is a brief description of the item, highlighting its key features and benefits."}</p>
      </div>

      <div className="item-card-footer">
        <div className="actions-toolbar">
          <EditButton />
          <HeartButton />
          <EmojiReactPanel />
        </div>
      </div>
    </div>
  );
};

export default ItemCard;
