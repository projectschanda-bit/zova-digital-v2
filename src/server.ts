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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Phone normalizer
function normalizePhone(phone: string): string {
  phone = phone.replace(/\s+/g, '');
  if (phone.startsWith('+260')) return '0' + phone.substring(4);
  if (phone.startsWith('260') && phone.length === 12) return '0' + phone.substring(3);
  if (phone.length === 9 && phone.startsWith('9')) return '0' + phone;
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

  const phone = normalizePhone(String(rawPhone));
  const operator = network.toLowerCase();
  const reference = `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const lencoPayload = {
    amount: parseFloat(String(amount)),
    currency,
    operator,
    phone,
    reference,
    bearer: 'customer',
  };

  try {
    const lencoRes = await fetch(`${LENCO_BASE_URL}/collections`, {
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

    if (lencoRes.ok && responseData.status === true) {
      const txnId = responseData.data?.id || reference;
      transactionStore.set(txnId, product || 'Digital Asset');
      res.json({ success: true, transaction_id: txnId });
    } else {
      res.json({ success: false, message: responseData.message || 'Payment initiation failed.' });
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
