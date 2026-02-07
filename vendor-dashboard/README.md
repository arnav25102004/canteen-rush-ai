# 🍔 Canteen Rush AI - Kitchen Display System

A professional, production-ready **Kitchen Display System (KDS)** for university cafeterias built with React. Features a dark mode interface with real-time order tracking, status management, and a modern UI inspired by McDonald's and Domino's kitchen displays.

---

## 🚀 Features

- ✅ **Real-time Order Polling** - Automatically fetches new orders every 3 seconds
- ✅ **Dark Mode UI** - Professional dark theme with neon accents
- ✅ **Status Management** - Visual indicators for Pending, Preparing, Ready, and Completed orders
- ✅ **Grid Layout** - Responsive card-based layout for easy order viewing
- ✅ **One-Click Completion** - Mark orders as complete with a single button click
- ✅ **Live Statistics** - Real-time active order count and current time display
- ✅ **Error Handling** - Graceful error states with retry functionality
- ✅ **Loading States** - Professional loading animations
- ✅ **Responsive Design** - Works on desktop, tablet, and mobile devices

---

## 🛠️ Technology Stack

- **React 19.2.4** - Functional Components with Hooks
- **Axios 1.13.4** - HTTP client for API communication
- **Pure CSS** - No external CSS frameworks (Tailwind/Bootstrap)
- **React Scripts 5.0.1** - Build tooling

---

## 📋 Prerequisites

Before running this application, ensure you have:

1. **Node.js** (v14 or higher) and **npm** installed
2. **Backend API** running on `http://localhost:8000` with the following endpoints:
   - `GET /queue` - Returns array of orders
   - `POST /complete/{id}` - Marks order as complete

---

## 🎯 Installation & Setup

### 1. Navigate to the project directory
```bash
cd vendor-dashboard
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start the development server
```bash
npm start
```

The application will open automatically at `http://localhost:3000`

---

## 📡 API Integration

### Backend API Specifications

#### GET /queue
Returns an array of order objects:
```json
[
  {
    "id": 1,
    "student_id": "STU12345",
    "item": "Chicken Burger",
    "qty": 2,
    "predicted_time": 15,
    "status": "pending"
  }
]
```

#### POST /complete/{id}
Marks an order as complete. Replace `{id}` with the order ID.

**Example:**
```bash
curl -X POST http://localhost:8000/complete/1
```

---

## 🎨 UI/UX Features

### Color Coding by Status
- **🟡 Pending** - Yellow/Orange accent
- **🔵 Preparing** - Blue accent
- **🟢 Ready** - Green accent with glow effect
- **⚪ Completed** - Gray accent

### Visual Indicators
- **Live Status Badge** - Pulsing green indicator in header
- **Order Cards** - Color-coded left border based on status
- **Neon Effects** - Glowing buttons for "Ready" orders
- **Smooth Animations** - Fade-in effects and hover states

---

## 📁 Project Structure

```
vendor-dashboard/
├── public/
│   └── index.html          # HTML template with updated title
├── src/
│   ├── App.js              # Main application component
│   ├── App.css             # Application-specific styles
│   ├── index.js            # React entry point
│   └── index.css           # Global styles and resets
├── package.json            # Dependencies and scripts
└── README.md               # This file
```

---

## 🔧 Available Scripts

### `npm start`
Runs the app in development mode at [http://localhost:3000](http://localhost:3000)

### `npm run build`
Builds the app for production to the `build` folder

### `npm test`
Launches the test runner in interactive watch mode

### `npm run eject`
**Note: this is a one-way operation!** Ejects from Create React App configuration

---

## 🎯 How It Works

1. **Polling Mechanism** - App polls the `/queue` endpoint every 3 seconds
2. **Order Display** - Orders are displayed in a responsive grid layout
3. **Status Updates** - Visual indicators update based on order status
4. **Complete Action** - Clicking "Mark as Complete" sends POST request to `/complete/{id}`
5. **Auto Refresh** - Order list refreshes automatically after completion

---

## 🐛 Troubleshooting

### Backend Connection Error
**Problem:** "Failed to fetch orders. Is the backend running?"

**Solution:**
- Ensure backend is running on `http://localhost:8000`
- Check that CORS is enabled on the backend
- Verify API endpoints are accessible

### Orders Not Updating
**Problem:** Orders don't refresh automatically

**Solution:**
- Check browser console for errors
- Verify network tab shows successful API calls
- Ensure backend is returning valid JSON

### Styling Issues
**Problem:** UI doesn't look correct

**Solution:**
- Clear browser cache
- Ensure `App.css` and `index.css` are properly loaded
- Check browser console for CSS errors

---

## 🎨 Customization

### Change Polling Interval
Edit `App.js` line 24:
```javascript
const interval = setInterval(fetchOrders, 3000); // Change 3000 to desired ms
```

### Modify Color Scheme
Edit CSS variables in `App.css`:
```css
:root {
  --accent-primary: #00d9ff;    /* Change primary accent color */
  --accent-success: #10b981;    /* Change success color */
  /* ... other variables */
}
```

### Adjust Grid Layout
Edit `App.css` line 260:
```css
.orders-grid {
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  /* Change 320px to adjust card width */
}
```

---

## 📱 Responsive Breakpoints

- **Desktop:** > 1024px - Multi-column grid
- **Tablet:** 768px - 1024px - Adjusted grid
- **Mobile:** < 768px - Single column layout

---

## 🚀 Production Deployment

### Build for Production
```bash
npm run build
```

This creates an optimized production build in the `build/` folder.

### Serve Production Build
```bash
npx serve -s build
```

---

## 📝 License

This project is built for the **Canteen Rush AI Hackathon**.

---

## 👨‍💻 Developer Notes

### Code Quality
- ✅ Functional components with React Hooks
- ✅ Proper error handling and loading states
- ✅ Clean, commented code
- ✅ Responsive design patterns
- ✅ Accessibility considerations

### Performance Optimizations
- Efficient state management
- Debounced API calls
- Optimized re-renders
- CSS animations using GPU acceleration

---

## 🎓 Hackathon Ready

This codebase is **production-ready** and includes:
- ✅ Complete file structure
- ✅ No placeholders or TODOs
- ✅ Professional UI/UX
- ✅ Error handling
- ✅ Responsive design
- ✅ Clean, maintainable code

---

## 📞 Support

For issues or questions during the hackathon, check:
1. Browser console for errors
2. Network tab for API calls
3. This README for troubleshooting

---

**Built with ❤️ for University Cafeterias**
