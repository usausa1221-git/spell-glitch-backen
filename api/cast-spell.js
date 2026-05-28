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
                "Respond ONLY with a single JSON object. No explanation, no markdown, no code block.\n" +
                "{\n" +
                "  \"power\": <number 0.3-3.0>,\n" +
                "  \"element\": \"<fire|water|thunder|wind|dark|glitch>\",\n" +
                "  \"effect\": \"<short visual description>\",\n" +
                "  \"log_message\": \"<flavor text>\",\n" +
                "  \"status_effect\": \"<none|poison|stun|burn|blind|curse>\"\n" +
                "}\n\n" +
                "status_effect rules: power<=0.7=none, power0.8-1.4=blind or none, power>=1.5=poison or burn or stun";
        } else {
            prompt =
                "Game: Spell Glitch. Evaluate this spell incantation: \"" + spell + "\"\n\n" +
                "Respond ONLY with a single JSON object. No explanation, no markdown, no code block.\n" +
                "{\n" +
                "  \"power\": <number 0.1-5.0>,\n" +
                "  \"element\": \"<fire|water|thunder|wind|dark|glitch|heal>\",\n" +
                "  \"effect\": \"<short visual description>\",\n" +
                "  \"log_message\": \"<flavor text>\",\n" +
                "  \"status_effect\": \"<none|poison|stun|burn|blind|curse>\",\n" +
                "  \"backlash_damage\": <number 0.00-0.50>,\n" +
                "  \"backlash_status\": \"<none|burn|blind|stun|curse|poison>\"\n" +
                "}\n\n" +
                "power rules: simple spell=0.3-0.7, modified spell=0.8-1.5, chaotic spell=2.0-5.0\n" +
                "status_effect rules: power<=0.7=none, power0.8-1.4=blind or none, power1.5-2.4=poison/burn/blind, power>=2.5=stun/curse/poison\n" +
                "backlash rules (self-damage the caster suffers for powerful spells):\n" +
                "  power<2.5 -> backlash_damage=0.00, backlash_status=none\n" +
                "  power2.5-3.4 -> backlash_damage=0.05-0.10, backlash_status=none\n" +
                "  power3.5-4.4 -> backlash_damage=0.10-0.20, backlash_status=burn or blind or none\n" +
                "  power>=4.5 -> backlash_damage=0.20-0.50, backlash_status=stun or curse or poison\n" +
                "  element=glitch -> backlash_damage +0.10, higher chance of backlash_status";
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

        // ✅ JSONパース：```json ... ``` のコードブロックが含まれていても対応
        let parsed;
        try {
            const jsonMatch = rawAiText.match(/```json\s*([\s\S]*?)```/) ||
                              rawAiText.match(/```\s*([\s\S]*?)```/)     ||
                              rawAiText.match(/(\{[\s\S]*\})/);
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawAiText;
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            console.error("JSON parse failed:", e.message, "| Raw:", rawAiText);
            return res.status(500).json({ error: 'Failed to parse Gemini response as JSON.', raw: rawAiText });
        }

        // ✅ 値の正規化（型安全・デフォルト値）
        let power          = parseFloat(parsed.power)          || 0.5;
        let element        = (parsed.element        || 'fire').toLowerCase();
        let effect         = parsed.effect          || 'A mysterious energy surges.';
        let log            = parsed.log_message     || 'The spell was cast.';
        let status         = (parsed.status_effect  || 'none').toLowerCase();
        let backlashDamage = parseFloat(parsed.backlash_damage) || 0.0;
        let backlashStatus = (parsed.backlash_status || 'none').toLowerCase();

        // ✅ 敵用はバックラッシュなし
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

        // ✅ プレイヤー用：バックラッシュのサーバー側補正
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

        // ✅ 通常status補正
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
