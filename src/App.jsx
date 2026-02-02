import React, { useState, useEffect, useMemo } from 'react';
import { Snowflake, Plus, Users, Wallet, ArrowRight, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const expensesCollectionRef = collection(db, 'expenses');

// --- APP CONFIGURATION ---
const PARTICIPANT_CONFIG = {
  "Theo": "TH",
  "Lillian": "LL",
  "Ruben": "RB",
  "Noreen": "NR",
  "Casper": "CS",
  "Swenne": "SW",
  "Anneke": "AJ",
  "Michael": "MG",
  "Marten": "MM"
};

const DEFAULT_PARTICIPANTS = Object.keys(PARTICIPANT_CONFIG);

export default function App() {
  // --- STATE ---
  const [participants] = useState(DEFAULT_PARTICIPANTS);
  const [expenses, setExpenses] = useState([]);
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Form State
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [payer, setPayer] = useState(DEFAULT_PARTICIPANTS[0]); // Default to first person
  const [involved, setInvolved] = useState([]); // Default to NONE selected

  // --- INIT LOAD ---
  useEffect(() => {
    let unsubscribe = null;

    const initFirebase = async () => {
      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error('Failed to sign in anonymously', error);
        return;
      }

      unsubscribe = onSnapshot(
        expensesCollectionRef,
        (snapshot) => {
          const nextExpenses = snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data()
          }));
          setExpenses(nextExpenses);
        },
        (error) => {
          console.error('Failed to load data', error);
        }
      );
    };

    initFirebase();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // --- LOGIC: BALANCES ---
  const balances = useMemo(() => {
    const bal = {};
    participants.forEach(p => bal[p] = 0);

    expenses.forEach(exp => {
      // Prevent division by zero if somehow involved is empty
      if (!exp.involved || exp.involved.length === 0) return;

      const share = exp.amount / exp.involved.length;
      // The payer gets positive credit (they paid)
      bal[exp.payer] += parseFloat(exp.amount);
      // Everyone involved gets negative debit (they consumed)
      exp.involved.forEach(person => {
        bal[person] -= share;
      });
    });
    return bal;
  }, [expenses, participants]);

  const totalSpent = expenses.reduce((sum, item) => sum + parseFloat(item.amount), 0);
  const sortedExpenses = useMemo(() => {
    return [...expenses].sort((a, b) => {
      const aTime = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.parse(a.date) || 0;
      const bTime = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : Date.parse(b.date) || 0;
      return bTime - aTime;
    });
  }, [expenses]);
  const visibleExpenses = showAllHistory ? sortedExpenses : sortedExpenses.slice(0, 3);

  // --- ACTIONS ---
  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!amount || !description || involved.length === 0) return;

    const newExpense = {
      amount: parseFloat(amount),
      description,
      payer,
      involved,
      date: new Date().toISOString(),
      createdAt: serverTimestamp()
    };

    try {
      await addDoc(expensesCollectionRef, newExpense);
    } catch (error) {
      console.error('Failed to add expense', error);
      return;
    }
    
    // Reset Form (Keep Payer same, clear involved)
    setAmount('');
    setDescription('');
    setInvolved([]); 
  };

  const handleDeleteExpense = async (id) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (error) {
      console.error('Failed to delete expense', error);
    }
  };

  const toggleInvolved = (person) => {
    if (involved.includes(person)) {
      setInvolved(involved.filter(p => p !== person));
    } else {
      setInvolved([...involved, person]);
    }
  };

  const setOnly = (person) => {
    setInvolved([person]);
  };

  const selectAll = () => {
    setInvolved(participants);
  };

  // --- LOGIC: SETTLEMENT ALGORITHM ---
  const calculateSettlements = () => {
    let debtors = [];
    let creditors = [];
    
    // 1. Separate into two lists
    Object.entries(balances).forEach(([person, amount]) => {
      // Round to 2 decimals to avoid floating point weirdness
      const val = Math.round(amount * 100) / 100;
      if (val < -0.01) debtors.push({ person, amount: val }); // Negative amount
      if (val > 0.01) creditors.push({ person, amount: val });
    });

    // 2. Sort by magnitude (optional, helps heuristics)
    debtors.sort((a, b) => a.amount - b.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transactions = [];

    // 3. Greedy matching
    let i = 0; // debtor index
    let j = 0; // creditor index

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];

      // The amount to settle is the minimum of what debtor owes vs what creditor is owed
      const amountToSettle = Math.min(Math.abs(debtor.amount), creditor.amount);

      transactions.push({
        from: debtor.person,
        to: creditor.person,
        amount: amountToSettle.toFixed(2)
      });

      // Adjust remaining balances
      debtor.amount += amountToSettle;
      creditor.amount -= amountToSettle;

      // If settled, move indices
      if (Math.abs(debtor.amount) < 0.01) i++;
      if (creditor.amount < 0.01) j++;
    }

    return transactions;
  };

  const settlements = isSettleOpen ? calculateSettlements() : [];

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans selection:bg-orange-100 pb-20">
      
      {/* HEADER */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2 text-orange-600">
          <Snowflake size={24} />
          <span className="font-bold text-lg tracking-tight text-slate-900">SCHNEEGERVERTEILER</span>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Trip Cost</p>
          <p className="text-xl font-bold text-slate-900">€{totalSpent.toFixed(2)}</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-6 space-y-8">
        
        {/* ADD EXPENSE FORM */}
        <section className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Plus size={18} className="text-orange-500" />
            Add New Expense
          </h2>
          
          <form onSubmit={handleAddExpense} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Amount (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-200 text-slate-900"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Payer</label>
                <select
                  value={payer}
                  onChange={e => setPayer(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-200 text-slate-900"
                >
                  {participants.map(person => (
                    <option key={person} value={person}>{person}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="E.g. Chalet Groceries"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-200 text-slate-900"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">Who is involved?</label>
              <div className="flex flex-wrap gap-2">
                {participants.map(person => (
                  <button
                    type="button"
                    key={person}
                    onClick={() => toggleInvolved(person)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                      involved.includes(person)
                        ? 'bg-orange-500 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {person}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={selectAll} className="text-xs text-orange-600 font-medium">Select All</button>
                <span className="text-slate-300">•</span>
                <button type="button" onClick={() => setInvolved([])} className="text-xs text-slate-500 font-medium">Clear</button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-orange-500 text-white py-2.5 rounded-lg font-semibold hover:bg-orange-600 transition"
            >
              Add Expense
            </button>
          </form>
        </section>

        {/* EXPENSE LIST */}
        <section className="space-y-3">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <Wallet size={18} className="text-orange-500" />
            Expenses
          </h2>
          
          {expenses.length === 0 && (
            <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-4 border border-slate-100">
              No expenses yet. Add the first expense above.
            </div>
          )}

          {visibleExpenses.map(exp => (
            <div key={exp.id} className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm flex justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">€{exp.amount.toFixed(2)} · {exp.description}</p>
                <p className="text-xs text-slate-500 mt-1">Paid by {exp.payer}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Split between {exp.involved.join(', ')}
                </p>
              </div>
              <button
                onClick={() => handleDeleteExpense(exp.id)}
                className="text-slate-400 hover:text-red-500"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}

          {expenses.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllHistory(!showAllHistory)}
              className="w-full text-sm font-medium text-slate-600 flex items-center justify-center gap-2 py-2"
            >
              {showAllHistory ? 'Show less' : `Show all (${expenses.length}) expenses`}
              {showAllHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
        </section>

        {/* BALANCES */}
        <section className="space-y-3">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <Users size={18} className="text-orange-500" />
            Balances
          </h2>

          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm divide-y divide-slate-100">
            {Object.entries(balances).map(([person, amount]) => (
              <div key={person} className="flex justify-between py-2 text-sm">
                <span className="text-slate-700">{person}</span>
                <span className={`font-semibold ${amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  €{amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* SETTLE UP */}
        <section className="space-y-3">
          <button
            onClick={() => setIsSettleOpen(!isSettleOpen)}
            className="w-full bg-slate-900 text-white py-2.5 rounded-lg font-semibold hover:bg-slate-800 transition flex items-center justify-center gap-2"
          >
            {isSettleOpen ? 'Hide Settlements' : 'Settle Up'}
            <ArrowRight size={18} />
          </button>

          {isSettleOpen && (
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm space-y-3">
              {settlements.length === 0 && (
                <p className="text-sm text-slate-500">No settlements needed. Everyone is balanced.</p>
              )}
              {settlements.map((settlement, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {settlement.from} pays {settlement.to}
                  </span>
                  <span className="font-semibold text-slate-900">€{settlement.amount}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
