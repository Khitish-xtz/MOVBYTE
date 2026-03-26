import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { fetchProviders } from '../services/api';

interface ProviderInfo {
  display_name: string;
  value: string;
  version: string;
  type: string;
}

export default function Config() {
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('mb_tg_config');
    if (saved) {
      try {
        const cfg = JSON.parse(saved);
        setBotToken(cfg.botToken || '');
        setChannelId(cfg.channelId || '');
      } catch {}
    }
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const data = await fetchProviders();
      setProviders(data);
    } catch {
      setProviders([]);
    } finally {
      setLoadingProviders(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken.trim() || !channelId.trim()) {
      toast.error('Both fields are required');
      return;
    }
    localStorage.setItem('mb_tg_config', JSON.stringify({ botToken: botToken.trim(), channelId: channelId.trim() }));
    toast.success('Configuration saved');
  };

  const handleClear = () => {
    localStorage.removeItem('mb_tg_config');
    setBotToken('');
    setChannelId('');
    toast.success('Configuration cleared');
  };

  return (
    <div className="config-page">
      <div className="config-card">
        <h2 className="config-title">Settings</h2>
        <p className="config-subtitle">Configure Telegram and view active providers</p>

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">Telegram Bot Token</label>
            <input
              className="form-input"
              type="text"
              placeholder="1234567890:AAH_xxxxxxxxxxxxx"
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Telegram Channel ID</label>
            <input
              className="form-input"
              type="text"
              placeholder="-100123456789"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
            />
            <div className="form-help">Bot must be an admin in the channel to stream videos</div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Save Config</button>
            <button type="button" className="btn btn-secondary" onClick={handleClear}>Clear</button>
          </div>
        </form>

        <div className="config-section">
          <h3 className="config-section-title">Active Providers ({providers.length})</h3>
          {loadingProviders ? (
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <div className="spinner" style={{ width: '24px', height: '24px', margin: '0 auto' }} />
            </div>
          ) : (
            <div className="provider-list">
              {providers.map(p => (
                <div key={p.value} className="provider-item">
                  <div>
                    <div className="provider-name">{p.display_name}</div>
                    <div className="provider-type">{p.type} &middot; v{p.version}</div>
                  </div>
                  <div className="provider-status" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="config-section">
          <h3 className="config-section-title">Server Info</h3>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <p>Backend API: <code style={{ color: 'var(--success)' }}>http://localhost:4000</code></p>
            <p style={{ marginTop: '0.5rem' }}>Start the server with:</p>
            <code style={{ display: 'block', background: '#111', padding: '0.75rem', borderRadius: '6px', marginTop: '0.5rem', color: '#46d369', fontSize: '0.8rem' }}>
              node server.js
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
