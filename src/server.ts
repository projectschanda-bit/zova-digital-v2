import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as admin from 'firebase-admin';

dotenv.config();

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY as string);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'zova-digital-94458'
});

const db = admin.firestore();

const app = express();

const LENCO_API_KEY: string = process.env.LENCO_SECRET_KEY || '';
const LENCO_BASE_URL: string = process.env.LENCO_BASE_URL || 'https://api.lenco.co/access/v2';

const PRODUCT_CATALOG: Record<string, { price: number; file: string }> = {
  'Instagram Growth Blueprint (Zambia Edition)': { price: 4500.00, file: 'GrowthBlueprint.pdf' },
  'Viral Reel Hook Library': { price: 4500.00, file: 'ViralHookLibrary.pdf' },
  'Digital Product Starter Kit': { price: 4500.00, file: 'StarterKit.pdf' },
  'Influencer Media Kit (Canva)': { price: 4500.00, file: 'MediaKit.pdf' },
  'WhatsApp Sales Machine': { price: 4500.00, file: 'SalesMachine.pdf' },
  'AI for Content Creators': { price: 4500.00, file: 'AIPromptPack.pdf' },
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
    const countryCodePrefix = countryCodes[currency] || '';
    if (countryCodePrefix && phone.startsWith(countryCodePrefix)) phone = '0' + phone.substring(countryCodePrefix.length);
    if (phone.length === 9 && !phone.startsWith('0')) phone = '0' + phone;
    return phone;
}

// POST /api/pay
app.post('/api/pay', async (req: Request, res: Response) => {
  try {
    const { phone: rawPhone, currency, network, product } = req.body as {
      phone: string;
      currency: string;
      network: string;
      product: string;
    };

    if (!rawPhone || !network || !product) {
      res.status(400).json({ success: false, message: 'phone, network, and product are required.' });
      return;
    }

    const productInfo = PRODUCT_CATALOG[product];
    if (!productInfo) {
      res.status(400).json({ success: false, message: 'Invalid product' });
      return;
    }
    const amount = productInfo.price;

    const phone    = normalizePhone(String(rawPhone), currency);
    const rawNetworkOperator = network.trim().toLowerCase();
    const operatorMap = OPERATOR_MAP[currency];

    // Validate operator against the map for the specific currency
    if (!operatorMap || !operatorMap[rawNetworkOperator]) {
      res.status(400).json({ success: false, message: 'Unsupported network operator for this currency' });
      return;
    }

    const normalizedOperator = operatorMap[rawNetworkOperator];
    
    const reference = `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    console.log(`[Pay] phone=${phone} op=${normalizedOperator} currency=${currency} amount=${amount}`);

    const lencoPayload = {
      amount: parseFloat(String(amount)),
      currency,
      operator: normalizedOperator,
      phone,
      reference,
      bearer: 'merchant',
    };

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

    const transactionData    = (responseData.data || {}) as any;
    const txnId      = transactionData.id as string | undefined;
    const initialTransactionStatus = (transactionData.status || '').toUpperCase() as string;
    const reason     = transactionData.reasonForFailure as string | undefined;

    console.log(`[Pay] txnId=${txnId} initStatus=${initialTransactionStatus} reason=${reason || 'none'}`);

    if (txnId && initialTransactionStatus === 'FAILED') {
      // Transaction failed at initiation (e.g. insufficient funds, wrong PIN)
      res.json({
        success: false,
        message: reason || 'Payment failed. Please check your balance and try again.',
        immediate: true,
      });
    } else if (txnId && initialTransactionStatus !== 'CANCELLED') {
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
      await db.collection('transactions').doc(txnId).set({
        transactionId: txnId,
        status: initialTransactionStatus || 'PENDING',
        productName: product,
        amount: amount,
        createdAt: admin.firestore.Timestamp.fromDate(createdAt),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt)
      });
      res.json({ success: true, transaction_id: txnId });
    } else if (lencoRes.ok && responseData.status === true) {
      // Fallback for successful init without an explicit transaction ID
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
      await db.collection('transactions').doc(reference).set({
        transactionId: reference,
        status: 'PENDING',
        productName: product,
        amount: amount,
        createdAt: admin.firestore.Timestamp.fromDate(createdAt),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt)
      });
      res.json({ success: true, transaction_id: reference });
    } else {
      const errMsg = responseData.message || 'Unable to initiate payment. Check your number and try again.';
      console.error('[Lenco rejection]', responseData);
      res.json({ success: false, message: errMsg, errorCode: (responseData as any).errorCode });
    }
  } catch (err) {
    console.error('Lenco /api/pay error:', err);
    res.status(500).json({ success: false, message: 'Payment processing failed.' });
  }
});

// GET /api/status/:transaction_id
app.get('/api/status/:transaction_id', async (req: Request, res: Response) => {
  const { transaction_id } = req.params;

  try {
    const docRef = db.collection('transactions').doc(transaction_id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      res.status(404).json({ success: false, message: 'Transaction not found.' });
      return;
    }

    const txData = docSnap.data();
    if (!txData || !txData.expiresAt || txData.expiresAt.toDate() < new Date()) {
      res.status(404).json({ success: false, message: 'Transaction expired or invalid.' });
      return;
    }

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
        product_name = txData.productName;
        const productInfo = PRODUCT_CATALOG[product_name as string];
        if (!productInfo) {
          res.status(400).json({ success: false, message: 'Invalid product.' });
          return;
        }
        download_link = `/assets/${productInfo.file}`;
      } else if (status === 'FAILED') {
        reason = data.reasonForFailure || 'Payment was declined.';
      }

      res.json({ success: true, status, download_link, product_name, reason });
    } else {
      res.json({ success: false, message: 'Could not retrieve transaction status.' });
    }
  } catch (err) {
    console.error('Lenco /api/status error:', err);
    res.status(500).json({ success: false, message: 'Payment processing failed.' });
  }
});

// POST /api/webhook
app.post('/api/webhook', async (req: Request, res: Response) => {
  try {
    // Placeholder for Lenco signature verification
    // const signature = req.headers['x-lenco-signature'];
    // if (!verifySignature(req.body, signature, LENCO_API_KEY)) {
    //   return res.status(401).send('Unauthorized');
    // }

    const { transactionId, status } = req.body;

    if (!transactionId || !status) {
      return res.status(400).send('Missing payload fields');
    }

    await db.collection('transactions').doc(transactionId).update({ 
      status: status.toUpperCase() 
    });

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    // Return 200 to acknowledge receipt and avoid retry loops
    res.status(200).send('OK');
  }
});

// Required for Vercel
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
