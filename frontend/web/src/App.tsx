import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface MatchProfile {
  id: string;
  name: string;
  encryptedInterest: string;
  publicAge: number;
  publicDistance: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface MatchAnalysis {
  compatibility: number;
  interestMatch: number;
  distanceScore: number;
  ageCompatibility: number;
  privacyScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<MatchProfile[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newProfileData, setNewProfileData] = useState({ name: "", interest: "", age: "", distance: "", description: "" });
  const [selectedProfile, setSelectedProfile] = useState<MatchProfile | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showStats, setShowStats] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const profilesList: MatchProfile[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          profilesList.push({
            id: businessId,
            name: businessData.name,
            encryptedInterest: businessId,
            publicAge: Number(businessData.publicValue1) || 0,
            publicDistance: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading profile data:', e);
        }
      }
      
      setProfiles(profilesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createProfile = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProfile(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating profile with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const interestValue = parseInt(newProfileData.interest) || 0;
      const businessId = `profile-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, interestValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProfileData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newProfileData.age) || 0,
        parseInt(newProfileData.distance) || 0,
        newProfileData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Profile created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewProfileData({ name: "", interest: "", age: "", distance: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProfile(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Interest data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Interest data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is available: ${isAvailable}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeMatch = (profile: MatchProfile, decryptedInterest: number | null): MatchAnalysis => {
    const interest = profile.isVerified ? (profile.decryptedValue || 0) : (decryptedInterest || 50);
    
    const baseCompatibility = Math.min(100, Math.round((interest * 0.6 + profile.publicAge * 2 + (100 - profile.publicDistance) * 0.3)));
    const timeFactor = Math.max(0.8, Math.min(1.2, 1 - (Date.now()/1000 - profile.timestamp) / (60 * 60 * 24 * 7)));
    const compatibility = Math.round(baseCompatibility * timeFactor);
    
    const interestMatch = Math.round(interest * 0.8 + Math.random() * 20);
    const distanceScore = Math.max(10, Math.min(100, 100 - profile.publicDistance * 2));
    const ageCompatibility = Math.round(100 - Math.abs(profile.publicAge - 30) * 2);
    const privacyScore = profile.isVerified ? 95 : Math.round(70 + Math.random() * 25);

    return {
      compatibility,
      interestMatch,
      distanceScore,
      ageCompatibility,
      privacyScore
    };
  };

  const getStats = () => {
    const totalProfiles = profiles.length;
    const verifiedProfiles = profiles.filter(p => p.isVerified).length;
    const avgAge = profiles.length > 0 
      ? profiles.reduce((sum, p) => sum + p.publicAge, 0) / profiles.length 
      : 0;
    const recentProfiles = profiles.filter(p => 
      Date.now()/1000 - p.timestamp < 60 * 60 * 24
    ).length;

    return { totalProfiles, verifiedProfiles, avgAge, recentProfiles };
  };

  const filteredProfiles = profiles.filter(profile =>
    profile.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    profile.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>靈魂隱私匹配 🔐</h1>
            <p>SoulMatch FHE - 保護隱私的約會匹配</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💖</div>
            <h2>連接錢包開始靈魂匹配</h2>
            <p>使用FHE全同態加密技術保護您的隱私，安全尋找靈魂伴侶</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>連接您的加密錢包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系統自動初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>開始加密匹配旅程</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系統...</p>
        <p className="loading-note">正在加載隱私保護匹配引擎</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加載加密匹配系統...</p>
    </div>
  );

  const stats = getStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>靈魂隱私匹配 🔐</h1>
          <p>FHE-Based Dating Matchmaker</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            測試連接
          </button>
          <button onClick={() => setShowStats(!showStats)} className="stats-btn">
            {showStats ? '隱藏統計' : '顯示統計'}
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + 創建檔案
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content-container">
        {showStats && (
          <div className="stats-section">
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">👥</div>
                <div className="stat-info">
                  <div className="stat-value">{stats.totalProfiles}</div>
                  <div className="stat-label">總檔案數</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">✅</div>
                <div className="stat-info">
                  <div className="stat-value">{stats.verifiedProfiles}</div>
                  <div className="stat-label">已驗證</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">📊</div>
                <div className="stat-info">
                  <div className="stat-value">{stats.avgAge.toFixed(1)}</div>
                  <div className="stat-label">平均年齡</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🆕</div>
                <div className="stat-info">
                  <div className="stat-value">{stats.recentProfiles}</div>
                  <div className="stat-label">今日新增</div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div className="search-section">
          <div className="search-container">
            <input
              type="text"
              placeholder="搜尋匹配檔案..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "刷新中..." : "🔁"}
            </button>
          </div>
        </div>
        
        <div className="profiles-section">
          <div className="section-header">
            <h2>靈魂匹配檔案</h2>
            <span className="profile-count">{filteredProfiles.length} 個檔案</span>
          </div>
          
          <div className="profiles-grid">
            {filteredProfiles.length === 0 ? (
              <div className="no-profiles">
                <p>暫無匹配檔案</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  創建第一個檔案
                </button>
              </div>
            ) : (
              filteredProfiles.map((profile, index) => (
                <ProfileCard
                  key={index}
                  profile={profile}
                  onSelect={setSelectedProfile}
                  onDecrypt={decryptData}
                />
              ))
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateProfileModal
          onSubmit={createProfile}
          onClose={() => setShowCreateModal(false)}
          creating={creatingProfile}
          profileData={newProfileData}
          setProfileData={setNewProfileData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedProfile && (
        <ProfileDetailModal
          profile={selectedProfile}
          onClose={() => {
            setSelectedProfile(null);
            setDecryptedData(null);
          }}
          decryptedInterest={decryptedData}
          setDecryptedInterest={setDecryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedProfile.id)}
          analyzeMatch={analyzeMatch}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ProfileCard: React.FC<{
  profile: MatchProfile;
  onSelect: (profile: MatchProfile) => void;
  onDecrypt: (id: string) => Promise<number | null>;
}> = ({ profile, onSelect, onDecrypt }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await onDecrypt(profile.id);
    setLocalDecrypted(result);
  };

  return (
    <div className="profile-card" onClick={() => onSelect(profile)}>
      <div className="card-header">
        <h3>{profile.name}</h3>
        <span className={`verification-badge ${profile.isVerified ? 'verified' : 'pending'}`}>
          {profile.isVerified ? '✅ 已驗證' : '🔒 加密中'}
        </span>
      </div>
      
      <div className="card-content">
        <div className="profile-info">
          <div className="info-item">
            <span>年齡:</span>
            <strong>{profile.publicAge}歲</strong>
          </div>
          <div className="info-item">
            <span>距離:</span>
            <strong>{profile.publicDistance}km</strong>
          </div>
          <div className="info-item">
            <span>興趣匹配:</span>
            <strong>
              {profile.isVerified ? 
                `${profile.decryptedValue}%` : 
                localDecrypted ? 
                `${localDecrypted}%` : 
                "🔒 加密"
              }
            </strong>
          </div>
        </div>
        
        <p className="profile-desc">{profile.description}</p>
      </div>
      
      <div className="card-footer">
        <button 
          onClick={handleDecrypt}
          className={`decrypt-btn ${(profile.isVerified || localDecrypted) ? 'decrypted' : ''}`}
        >
          {profile.isVerified ? '✅ 已驗證' : localDecrypted ? '🔓 已解密' : '🔓 解密興趣'}
        </button>
        <span className="timestamp">
          {new Date(profile.timestamp * 1000).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
};

const CreateProfileModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  profileData: any;
  setProfileData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, profileData, setProfileData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'interest') {
      const intValue = value.replace(/[^\d]/g, '');
      setProfileData({ ...profileData, [name]: intValue });
    } else {
      setProfileData({ ...profileData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-profile-modal">
        <div className="modal-header">
          <h2>創建靈魂匹配檔案</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 隱私保護</strong>
            <p>興趣值將使用FHE加密技術保護，只有匹配成功後才會解密</p>
          </div>
          
          <div className="form-group">
            <label>暱稱 *</label>
            <input 
              type="text" 
              name="name" 
              value={profileData.name} 
              onChange={handleChange} 
              placeholder="輸入您的暱稱..." 
            />
          </div>
          
          <div className="form-group">
            <label>興趣匹配值 (0-100) *</label>
            <input 
              type="number" 
              name="interest" 
              value={profileData.interest} 
              onChange={handleChange} 
              placeholder="0-100的整數" 
              min="0"
              max="100"
            />
            <div className="data-type-label">FHE加密整數</div>
          </div>
          
          <div className="form-group">
            <label>年齡 *</label>
            <input 
              type="number" 
              name="age" 
              value={profileData.age} 
              onChange={handleChange} 
              placeholder="您的年齡" 
              min="18"
              max="100"
            />
          </div>
          
          <div className="form-group">
            <label>期望距離 (km) *</label>
            <input 
              type="number" 
              name="distance" 
              value={profileData.distance} 
              onChange={handleChange} 
              placeholder="最大匹配距離" 
              min="1"
              max="1000"
            />
          </div>
          
          <div className="form-group">
            <label>個人描述</label>
            <textarea 
              name="description" 
              value={profileData.description} 
              onChange={handleChange} 
              placeholder="簡單介紹一下自己..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !profileData.name || !profileData.interest || !profileData.age || !profileData.distance} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密並創建中..." : "創建檔案"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProfileDetailModal: React.FC<{
  profile: MatchProfile;
  onClose: () => void;
  decryptedInterest: number | null;
  setDecryptedInterest: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  analyzeMatch: (profile: MatchProfile, decryptedInterest: number | null) => MatchAnalysis;
}> = ({ profile, onClose, decryptedInterest, setDecryptedInterest, isDecrypting, decryptData, analyzeMatch }) => {
  const handleDecrypt = async () => {
    if (decryptedInterest !== null) {
      setDecryptedInterest(null);
      return;
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedInterest(decrypted);
    }
  };

  const analysis = analyzeMatch(profile, decryptedInterest);

  return (
    <div className="modal-overlay">
      <div className="profile-detail-modal">
        <div className="modal-header">
          <h2>匹配檔案詳情</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="profile-info-detailed">
            <div className="info-grid">
              <div className="info-item">
                <span>暱稱:</span>
                <strong>{profile.name}</strong>
              </div>
              <div className="info-item">
                <span>年齡:</span>
                <strong>{profile.publicAge}歲</strong>
              </div>
              <div className="info-item">
                <span>期望距離:</span>
                <strong>{profile.publicDistance}km</strong>
              </div>
              <div className="info-item">
                <span>創建時間:</span>
                <strong>{new Date(profile.timestamp * 1000).toLocaleString()}</strong>
              </div>
            </div>
            
            <div className="description-section">
              <h4>個人描述</h4>
              <p>{profile.description}</p>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>🔐 加密興趣數據</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>興趣匹配值:</span>
                <strong>
                  {profile.isVerified ? 
                    `${profile.decryptedValue}% (區塊鏈驗證)` : 
                    decryptedInterest !== null ? 
                    `${decryptedInterest}% (本地解密)` : 
                    "🔒 FHE加密保護"
                  }
                </strong>
              </div>
              <button 
                className={`decrypt-btn-large ${(profile.isVerified || decryptedInterest !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 驗證中..." :
                 profile.isVerified ? "✅ 已驗證" :
                 decryptedInterest !== null ? "🔄 重新驗證" : "🔓 驗證解密"}
              </button>
            </div>
          </div>
          
          {(profile.isVerified || decryptedInterest !== null) && (
            <div className="analysis-section">
              <h3>📊 匹配分析</h3>
              <div className="analysis-chart">
                <div className="chart-row">
                  <span>兼容性評分</span>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${analysis.compatibility}%` }}
                    >
                      <span>{analysis.compatibility}%</span>
                    </div>
                  </div>
                </div>
                <div className="chart-row">
                  <span>興趣匹配度</span>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${analysis.interestMatch}%` }}
                    >
                      <span>{analysis.interestMatch}%</span>
                    </div>
                  </div>
                </div>
                <div className="chart-row">
                  <span>距離適配</span>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${analysis.distanceScore}%` }}
                    >
                      <span>{analysis.distanceScore}%</span>
                    </div>
                  </div>
                </div>
                <div className="chart-row">
                  <span>年齡兼容</span>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${analysis.ageCompatibility}%` }}
                    >
                      <span>{analysis.ageCompatibility}%</span>
                    </div>
                  </div>
                </div>
                <div className="chart-row">
                  <span>隱私安全</span>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${analysis.privacyScore}%` }}
                    >
                      <span>{analysis.privacyScore}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">關閉</button>
          {!profile.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              {isDecrypting ? "區塊鏈驗證中..." : "上鏈驗證"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


