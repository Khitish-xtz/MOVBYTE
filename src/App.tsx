import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Movies from './pages/Movies';
import Series from './pages/Series';
import Watch from './pages/Watch';
import Config from './pages/Config';
import './index.css';

function App() {
  return (
    <Router>
      <div className="app">
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: { background: '#1f1f1f', color: '#fff', borderRadius: '8px' },
            success: { iconTheme: { primary: '#46d369', secondary: '#1f1f1f' } },
            error: { iconTheme: { primary: '#e50914', secondary: '#1f1f1f' } },
          }}
        />
        <Navbar />
        <div className="page">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/movies" element={<Movies />} />
            <Route path="/series" element={<Series />} />
            <Route path="/watch" element={<Watch />} />
            <Route path="/config" element={<Config />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
