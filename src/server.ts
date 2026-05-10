import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();

const LENCO_API_KEY: string = process.env.LENCO_SECRET_KEY || '';
const LENCO_BASE_URL: string = process.env.LENCO_BASE_URL || 'https://api.lenco.co/access/v2';
const transactionStore = new Map<string, string>();

const PRODUCT_MAP: Record<string, string> = {
  'Instagram Growth Blueprint (Zambia Edition)': 'GrowthBlueprint.pdf',
  'Viral Reel Hook Library': 'ViralHookLibrary.pdf',
  'Digital Product Starter Kit': 'StarterKit.pdf',
  'Influencer Media Kit (Canva)': 'MediaKit.pdf',
  'WhatsApp Sales Machine': 'SalesMachine.pdf',
  'AI for Content Creators': 'AIPromptPack.pdf',
};

// Lenco operator slugs — must match Lenco's expected values per currency
const OPERATOR_MAP: Record<string, Record<string, string>> = {
  ZMW: { mtn: 'mtn', airtel: 'airtel', zamtel: 'zamtel' },
  KES: { safaricom: 'safaricom', airtel: 'airtel' },
  NGN: { mtn: 'mtn', airtel: 'airtel', glo: 'glo', '9mobile': '9mobile' },
  GHS: { mtn: 'mtn', airtel: 'airtel-tigo', vodafone: 'vodafone' },
  UGX: { mtn: 'mtn', airtel: 'airtel' },
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Phone normalizer — handles ZMW, KES, NGN, GHS, UGX
function normalizePhone(phone: string, currency = 'ZMW'): string {
  phone = phone.replace(/[\s\-\(\)]/g, '');
  if (phone.startsWith('+')) phone = phone.substring(1);

  const countryCodes: Record<string, string> = {
    ZMW: '260', KES: '254', NGN: '234', GHS: '233', UGX: '256',
  };
  const cc = countryCodes[currency] || '';
  if (cc && phone.startsWith(cc)) phone = '0' + phone.substring(cc.length);
  if (phone.length === 9 && !phone.startsWith('0')) phone = '0' + phone;
  return phone;
}

// POST /api/pay
app.post('/api/pay', async (req: Request, res: Response) => {
  const { phone: rawPhone, amount, currency, network, product } = req.body as {
    phone: string;
    amount: number;
    currency: string;
    network: string;
    product: string;
  };

  if (!rawPhone || !amount || !network) {
    res.status(400).json({ success: false, message: 'phone, amount, and network are required.' });
    return;
  }

  const phone    = normalizePhone(String(rawPhone), currency);
  const rawOp    = network.toLowerCase();
  const operator = (OPERATOR_MAP[currency] || {})[rawOp] || rawOp; // fallback to raw
  
  const countryMap: Record<string, string> = {
    ZMW: 'zm', KES: 'ke', NGN: 'ng', GHS: 'gh', UGX: 'ug'
  };
  const country = countryMap[currency] || 'zm';
  const reference = `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  console.log(`[Pay] phone=${phone} op=${operator} currency=${currency} amount=${amount}`);

  const lencoPayload = {
    amount: parseFloat(String(amount)),
    currency,
    operator,
    phone,
    country,
    reference,
    bearer: 'merchant',
    description: `Purchase of ${product || 'Digital Asset'}`
  };

  try {
    const lencoRes = await fetch(`${LENCO_BASE_URL}/collections/mobile-money`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LENCO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(lencoPayload),
    });

    const responseData = (await lencoRes.json()) as {
      status: boolean;
      message?: string;
      data?: { id?: string };
    };

    console.log('[Lenco /pay response]', JSON.stringify(responseData));

    const txnData    = (responseData.data || {}) as any;
    const txnId      = txnData.id as string | undefined;
    const initStatus = (txnData.status || '').toUpperCase() as string;
    const reason     = txnData.reasonForFailure as string | undefined;

    console.log(`[Pay] txnId=${txnId} initStatus=${initStatus} reason=${reason || 'none'}`);

    if (txnId && initStatus === 'FAILED') {
      // Transaction failed at initiation (e.g. insufficient funds, wrong PIN)
      res.json({
        success: false,
        message: reason || 'Payment failed. Please check your balance and try again.',
        immediate: true,
      });
    } else if (txnId && initStatus !== 'CANCELLED') {
      // Genuinely pending — start polling
      transactionStore.set(txnId, product || 'Digital Asset');
      res.json({ success: true, transaction_id: txnId });
    } else if (lencoRes.ok && responseData.status === true) {
      transactionStore.set(reference, product || 'Digital Asset');
      res.json({ success: true, transaction_id: reference });
    } else {
      const errMsg = responseData.message || 'Unable to initiate payment. Check your number and try again.';
      console.error('[Lenco rejection]', responseData);
      res.json({ success: false, message: errMsg, errorCode: (responseData as any).errorCode });
    }
  } catch (err) {
    console.error('Lenco /api/pay error:', err);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/status/:transaction_id
app.get('/api/status/:transaction_id', async (req: Request, res: Response) => {
  const { transaction_id } = req.params;

  try {
    const lencoRes = await fetch(`${LENCO_BASE_URL}/collections/status/${transaction_id}`, {
      headers: {
        Authorization: `Bearer ${LENCO_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const responseData = (await lencoRes.json()) as {
      status: boolean;
      data?: {
        status?: string;
        reasonForFailure?: string;
      };
    };

    if (lencoRes.ok && responseData.status === true) {
      const data = responseData.data || {};
      const status = (data.status || 'pending').toUpperCase();

      let download_link: string | undefined;
      let product_name: string | undefined;
      let reason: string | undefined;

      if (status === 'SUCCESSFUL') {
        product_name = transactionStore.get(transaction_id) || 'Digital Product';
        const filename = PRODUCT_MAP[product_name] || 'ZovaDigitalProduct.pdf';
        download_link = `/assets/${filename}`;
      } else if (status === 'FAILED') {
        reason = data.reasonForFailure || 'Payment was declined.';
      }

      res.json({ success: true, status, download_link, product_name, reason });
    } else {
      res.json({ success: false, message: 'Could not retrieve transaction status.' });
    }
  } catch (err) {
    console.error('Lenco /api/status error:', err);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Required for Vercel
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
