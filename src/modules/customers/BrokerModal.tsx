import React, { useState, useEffect } from 'react';
import { Briefcase, AlertTriangle } from 'lucide-react';
import { Broker } from '../../types/tms';
import { Modal } from '../../components/ui/Modal';
import { paiseToRupees, rupeesToPaise } from '../../lib/currency';
import { useFirestoreData } from '../../context/FirestoreDataContext';
import { saveBrokerInFirestore } from '../../lib/firebase/firestoreService';

interface BrokerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (broker: Broker, isEdit: boolean) => void;
  brokerToEdit?: Broker | null;
}

export const BrokerModal: React.FC<BrokerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  brokerToEdit,
}) => {
  const { company } = useFirestoreData();

  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [commissionRatePercent, setCommissionRatePercent] = useState('');
  const [defaultCommissionRupees, setDefaultCommissionRupees] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'BLOCKED'>('ACTIVE');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (brokerToEdit) {
      setName(brokerToEdit.name || '');
      setCompanyName(brokerToEdit.companyName || '');
      setPhone(brokerToEdit.phone || '');
      setEmail(brokerToEdit.email || '');
      setGstin(brokerToEdit.gstin || '');
      setPan(brokerToEdit.pan || '');
      setCity(brokerToEdit.city || '');
      setState(brokerToEdit.state || '');
      setCommissionRatePercent(
        brokerToEdit.commissionRatePercent !== undefined
          ? String(brokerToEdit.commissionRatePercent)
          : ''
      );
      setDefaultCommissionRupees(
        brokerToEdit.defaultCommissionPaise !== undefined
          ? String(paiseToRupees(brokerToEdit.defaultCommissionPaise))
          : ''
      );
      setStatus(brokerToEdit.status || 'ACTIVE');
      setNotes(brokerToEdit.notes || '');
    } else {
      setName('');
      setCompanyName('');
      setPhone('');
      setEmail('');
      setGstin('');
      setPan('');
      setCity('');
      setState('');
      setCommissionRatePercent('3');
      setDefaultCommissionRupees('');
      setStatus('ACTIVE');
      setNotes('');
    }
  }, [isOpen, brokerToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!company?.id) {
      setError('Active company profile is required.');
      return;
    }
    if (!name.trim() || !phone.trim()) {
      setError('Broker contact name and phone number are required.');
      return;
    }

    const rateNum = parseFloat(commissionRatePercent);
    const defaultCommNum = parseFloat(defaultCommissionRupees);

    const brokerId =
      brokerToEdit?.id || `brk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const brokerPayload: Broker = {
      id: brokerId,
      companyId: company.id,
      name: name.trim(),
      companyName: companyName.trim() || undefined,
      phone: phone.trim(),
      email: email.trim() || undefined,
      gstin: gstin.trim().toUpperCase() || undefined,
      pan: pan.trim().toUpperCase() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      commissionRatePercent:
        !Number.isNaN(rateNum) && rateNum >= 0 ? rateNum : undefined,
      defaultCommissionPaise:
        !Number.isNaN(defaultCommNum) && defaultCommNum >= 0
          ? rupeesToPaise(defaultCommNum)
          : undefined,
      status,
      notes: notes.trim() || undefined,
      createdAt: brokerToEdit?.createdAt || new Date().toISOString(),
    };

    setSaving(true);
    try {
      await saveBrokerInFirestore(company.id, brokerPayload);
      onSuccess(brokerPayload, Boolean(brokerToEdit));
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save freight broker.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={brokerToEdit ? `Edit Broker: ${brokerToEdit.name}` : 'Add Freight Broker / Agent'}
      subtitle="Saved brokers appear automatically inside Trip & Dispatch booking forms"
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Broker / Agent Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajesh Agarwal"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Agency / Brokerage Firm
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Agarwal Freight Carriers"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Phone / WhatsApp <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98300 11223"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="broker@firm.in"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Kolkata"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">State</label>
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="e.g. West Bengal"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">GSTIN (Optional)</label>
            <input
              type="text"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="19AABCU9603R1ZM"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">PAN (Optional)</label>
            <input
              type="text"
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="AABCU9603R"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Default Commission Rate (%)
            </label>
            <input
              type="number"
              step="0.25"
              min="0"
              value={commissionRatePercent}
              onChange={(e) => setCommissionRatePercent(e.target.value)}
              placeholder="e.g. 3"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Flat Commission Default (₹)
            </label>
            <input
              type="number"
              step="50"
              min="0"
              value={defaultCommissionRupees}
              onChange={(e) => setDefaultCommissionRupees(e.target.value)}
              placeholder="Optional flat fee"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="BLOCKED">Blocked</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Preferred lane / settlement terms"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5"
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : brokerToEdit ? 'Save Broker' : 'Register Broker'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
