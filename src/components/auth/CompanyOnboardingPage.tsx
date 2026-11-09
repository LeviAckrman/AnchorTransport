import React, { useState } from 'react';
import {
  Anchor,
  Building2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowRight,
  MapPin,
  FileText,
  Hash,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const CompanyOnboardingPage: React.FC = () => {
  const { user, onboardCompany, logout } = useAuth();

  const [companyName, setCompanyName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [gstin, setGstin] = useState('19AAACA1029E1Z5');
  const [pan, setPan] = useState('AAACA1029E');
  const [phone, setPhone] = useState(user?.phone || '+91 98300 12345');
  const [email, setEmail] = useState(user?.email || '');
  const [city, setCity] = useState('Kolkata');
  const [state, setState] = useState('West Bengal');
  const [stateCode, setStateCode] = useState('19');
  const [pincode, setPincode] = useState('700001');
  const [fleetSize, setFleetSize] = useState('10-25 Trucks');
  const [lrPrefix, setLrPrefix] = useState('AT/25-26/');
  const [invoicePrefix, setInvoicePrefix] = useState('INV/25-26/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive PAN and state code when GSTIN changes
  const handleGstinChange = (val: string) => {
    const uppercase = val.toUpperCase().trim();
    setGstin(uppercase);
    if (uppercase.length >= 2) {
      setStateCode(uppercase.substring(0, 2));
    }
    if (uppercase.length >= 12) {
      setPan(uppercase.substring(2, 12));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await onboardCompany({
      companyName,
      tradeName: tradeName || companyName,
      gstin,
      pan,
      phone,
      email: email || user?.email,
      city,
      state,
      stateCode,
      pincode,
      fleetSize,
      lrPrefix,
      invoicePrefix,
    });

    if (!result.success) {
      setError(result.error || 'Failed to complete company onboarding.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative select-none">
      {/* Background glow effects */}
      <div className="absolute top-10 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-2xl text-center mb-8 relative z-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 shadow-xl text-white mb-3 ring-4 ring-indigo-500/20">
          <Anchor className="w-8 h-8" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold mb-2">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Step 2 of 2: Trusted Company Onboarding</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Setup Your Fleet Transport Company
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-slate-400 max-w-lg mx-auto">
          Welcome <span className="text-white font-medium">{user?.name || user?.email}</span>. Establishing this company record will configure your isolated tenant database and assign you as verified <span className="text-emerald-400 font-semibold">OWNER</span>.
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-2xl relative z-10">
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-start gap-3 text-xs text-rose-300">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-200">Onboarding Error</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Legal Company Identity */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                1. Legal Fleet Entity
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Registered Company Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Royal Bengal Roadlines Pvt. Ltd."
                    className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Trade / Brand Name
                  </label>
                  <input
                    type="text"
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    placeholder="e.g. Royal Bengal Cargo"
                    className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Fleet Size Capacity
                  </label>
                  <select
                    value={fleetSize}
                    onChange={(e) => setFleetSize(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-hidden focus:border-indigo-500"
                  >
                    <option value="1-5 Trucks">1 - 5 Trucks (Small Fleet)</option>
                    <option value="5-10 Trucks">5 - 10 Trucks (Growing Fleet)</option>
                    <option value="10-25 Trucks">10 - 25 Trucks (Medium Commercial)</option>
                    <option value="25-50 Trucks">25 - 50 Trucks (Large Fleet)</option>
                    <option value="50+ Trucks">50+ Trucks (Heavy Transport Enterprise)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 2. Indian GST & Compliance */}
            <div className="pt-4 border-t border-slate-700/80">
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                2. Indian GST & Tax Compliance
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    GSTIN (15 Digits Alphanumeric) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => handleGstinChange(e.target.value)}
                    placeholder="e.g. 19AAACR4912D1ZX"
                    className="w-full px-3 py-2 text-xs font-mono uppercase bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Company PAN (Auto-derived)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={pan}
                    className="w-full px-3 py-2 text-xs font-mono uppercase bg-slate-900/60 border border-slate-700/60 rounded-lg text-slate-400 focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* 3. Operational Hub & Prefixes */}
            <div className="pt-4 border-t border-slate-700/80">
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                3. Operating Hub & Document Sequences
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Primary Hub City
                  </label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Howrah / Kolkata"
                    className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    State & GST State Code
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="State"
                      className="col-span-2 px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-hidden focus:border-indigo-500"
                    />
                    <input
                      type="text"
                      required
                      value={stateCode}
                      onChange={(e) => setStateCode(e.target.value)}
                      placeholder="Code (e.g. 19)"
                      className="col-span-1 px-3 py-2 text-xs font-mono text-center bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    LR / Bilty Prefix
                  </label>
                  <input
                    type="text"
                    required
                    value={lrPrefix}
                    onChange={(e) => setLrPrefix(e.target.value)}
                    placeholder="e.g. AT/25-26/"
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Freight Invoice Prefix
                  </label>
                  <input
                    type="text"
                    required
                    value={invoicePrefix}
                    onChange={(e) => setInvoicePrefix(e.target.value)}
                    placeholder="e.g. INV/25-26/"
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Security Assurance Notice */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-700/60 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-400 space-y-1">
                <p className="font-semibold text-slate-200">Owner Security Assurance</p>
                <p>
                  By completing onboarding, trusted server-side code provisions your company record and marks your account as verified <strong className="text-white">OWNER</strong> with full administration rights. No other user can claim Owner status.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-700">
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
              >
                {loading ? 'Creating Transport Company...' : 'Complete Setup & Launch TMS'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
