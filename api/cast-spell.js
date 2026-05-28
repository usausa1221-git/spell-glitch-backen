export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { spell, is_enemy } = req.body;

        if (!spell) {
            return res.status(400).json({ error: 'No spell provided in request body.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

        let prompt;

        if (is_enemy) {
            prompt =
                "Game: Spell Glitch. You are an enemy wizard casting a spell against the player.\n" +
                "Spell: \"" + spell + "\"\n\n" +
                "Output ONLY these 5 lines at the very end of your response:\n" +
                "POWER: [number 0.3-3.0]\n" +
                "ELEMENT: [fire/water/thunder/wind/dark/glitch]\n" +
                "EFFECT: [short visual description]\n" +
                "LOG: [flavor text]\n" +
                "STATUS: [none/poison/stun/burn/blind/curse]\n\n" +
                "STATUS rules: power<=0.7=none, power0.8-1.4=blind or none, power>=1.5=poison or burn or stun";
        } else {
            prompt =
                "Game: Spell Glitch. Evaluate this spell incantation: \"" + spell + "\"\n\n" +
                "Output ONLY these 7 lines at the very end of your response:\n" +
                "POWER: [number 0.1-5.0]\n" +
                // ✅ ここに "mana" を追加
                "ELEMENT: [fire/water/thunder/wind/dark/glitch/heal/mana]\n" +
                "EFFECT: [short visual description]\n" +
                "LOG: [flavor text]\n" +
                "STATUS: [none/poison/stun/burn/blind/curse]\n" +
                "BACKLASH_DAMAGE: [0.00-0.50]\n" +
                "BACKLASH_STATUS: [none/burn/blind/stun/curse/poison]\n\n" +
                "power rules: simple spell=0.3-0.7, modified spell=0.8-1.5, chaotic spell=2.0-5.0\n" +
                "STATUS rules: power<=0.7=none, power0.8-1.4=blind or none, power1.5-2.4=poison/burn/blind, power>=2.5=stun/curse/poison\n" +
                "BACKLASH rules (self-damage the caster suffers for powerful spells):\n" +
                "  power<2.5 -> BACKLASH_DAMAGE=0.00, BACKLASH_STATUS=none\n" +
                "  power2.5-3.4 -> BACKLASH_DAMAGE=0.05-0.10, BACKLASH_STATUS=none\n" +
                "  power3.5-4.4 -> BACKLASH_DAMAGE=0.10-0.20, BACKLASH_STATUS=burn or blind or none\n" +
                "  power>=4.5 -> BACKLASH_DAMAGE=0.20-0.50, BACKLASH_STATUS=stun or curse or poison\n" +
                "  element=glitch -> BACKLASH_DAMAGE +0.10, higher chance of BACKLASH_STATUS";
        }

        const requestPayload = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            console.error("Gemini API Error Response:", errText);
            return res.status(500).json({ error: 'Failed to communicate with Gemini API.', details: errText });
        }

        const responseData = await geminiResponse.json();
        const candidate = responseData.candidates?.[0];
        if (!candidate) {
            return res.status(500).json({ error: 'No response from Gemini.' });
        }

        let rawAiText = candidate.content?.parts?.[0]?.text?.trim();
        if (!rawAiText) {
            return res.status(500).json({ error: 'Empty response from Gemini.' });
        }

        console.log("Raw AI Response:", rawAiText);

        const extractLast = (key) => {
            const lines = rawAiText.split('\n');
            const keyLower = key.toLowerCase();
            let lastMatch = null;
            for (const line of lines) {
                const cleaned = line.replace(/^[\s\*\-\>]+/, '').trim();
                const colonIdx = cleaned.indexOf(':');
                if (colonIdx === -1) continue;
                const k = cleaned.slice(0, colonIdx).trim().toLowerCase();
                if (k === keyLower) {
                    const v = cleaned.slice(colonIdx + 1).trim();
                    if (v) lastMatch = v;
                }
            }
            return lastMatch;
        };

        const extractNumber = (key, fallback) => {
            const raw = extractLast(key) || '';
            const num = parseFloat(raw.match(/^[\d.]+/)?.[0]);
            return isNaN(num) ? fallback : num;
        };

        const extractWord = (key, fallback) => {
            const raw = extractLast(key) || '';
            return raw.match(/^[a-zA-Z_]+/)?.[0]?.toLowerCase() || fallback;
        };

        const power   = extractNumber('power',   0.5);
        const element = extractWord  ('element', 'fire');
        const effect  = extractLast  ('effect')  || 'A mysterious energy surges.';
        const log     = extractLast  ('log')     || 'The spell was cast.';
        let status    = extractWord  ('status',  'none');

        if (is_enemy) {
            if (power >= 2.5 && status === 'none') {
                status = ['stun', 'curse', 'poison'][Math.floor(Math.random() * 3)];
            } else if (power >= 1.5 && status === 'none') {
                status = ['poison', 'burn', 'blind'][Math.floor(Math.random() * 3)];
            }

            console.log(`Parsed → power:${power} element:${element} status:${status}`);

            return res.status(200).json({
                power,
                element,
                effect,
                log_message:   log,
                status_effect: status
            });
        }

        let backlashDamage = extractNumber('backlash_damage', 0.0);
        let backlashStatus = extractWord  ('backlash_status', 'none');

        const isGlitch = element === 'glitch';

        if (power < 2.5) {
            backlashDamage = 0.0;
            backlashStatus = 'none';
        } else if (power < 3.5) {
            const base = 0.05 + (power - 2.5) * 0.05;
            backlashDamage = Math.max(backlashDamage, isGlitch ? base + 0.10 : base);
            backlashStatus = 'none';
        } else if (power < 4.5) {
            const base = 0.10 + (power - 3.5) * 0.10;
            backlashDamage = Math.max(backlashDamage, isGlitch ? base + 0.10 : base);
            const threshold = isGlitch ? 0.5 : 0.3;
            if (backlashStatus === 'none' && Math.random() < threshold) {
                backlashStatus = ['burn', 'blind'][Math.floor(Math.random() * 2)];
            }
        } else {
            const base = 0.25 + (power - 4.5) * 0.10;
            backlashDamage = Math.max(backlashDamage, Math.min(isGlitch ? base + 0.15 : base, 0.50));
            if (backlashStatus === 'none') {
                backlashStatus = ['stun', 'curse', 'poison'][Math.floor(Math.random() * 3)];
            }
        }

        if (power >= 2.5 && status === 'none') {
            status = ['stun', 'curse', 'poison'][Math.floor(Math.random() * 3)];
        } else if (power >= 1.5 && status === 'none') {
            status = ['poison', 'burn', 'blind'][Math.floor(Math.random() * 3)];
        }

        console.log(`Parsed → power:${power} element:${element} status:${status} backlash_damage:${backlashDamage} backlash_status:${backlashStatus}`);

        return res.status(200).json({
            power,
            element,
            effect,
            log_message:      log,
            status_effect:    status,
            backlash_damage:  Math.round(backlashDamage * 100) / 100,
            backlash_status:  backlashStatus
        });

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({
            error:   'Internal Server Error',
            details: error.message
        });
    }
}
