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
                "Game: Spell Glitch. Evaluate this spell: \"" + spell + "\"\n\n" +
                "Output ONLY these 5 lines at the very end of your response:\n" +
                "POWER: [number 0.1-5.0]\n" +
                "ELEMENT: [fire/water/thunder/wind/dark/glitch/heal]\n" +
                "EFFECT: [short visual description]\n" +
                "LOG: [flavor text]\n" +
                "STATUS: [none/poison/stun/burn/blind/curse]\n\n" +
                "POWER rules: simple=0.3-0.7, modified=0.8-1.5, chaotic=2.0-5.0\n" +
                "STATUS rules: power<=0.7=none, power0.8-1.4=blind or none, power1.5-2.4=poison/burn/blind, power>=2.5=stun/curse/poison";
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

        // ✅ 最後に出現したキーワードを取得（思考過程より後に書かれた値を優先）
        const extractLast = (key) => {
            const regex = new RegExp('^' + key + ':\\s*(.+)', 'gim');
            let lastMatch = null;
            let match;
            while ((match = regex.exec(rawAiText)) !== null) {
                lastMatch = match[1].trim();
            }
            return lastMatch;
        };

        const power   = parseFloat(extractLast('POWER')) || 0.5;
        const element = extractLast('ELEMENT') || 'fire';
        const effect  = extractLast('EFFECT')  || 'A mysterious energy surges.';
        const log     = extractLast('LOG')     || 'The spell was cast.';
        let status    = (extractLast('STATUS') || 'none').toLowerCase();

        // powerが高いのにnoneの場合はサーバー側で補正
        if (power >= 2.5 && status === "none") {
            const effects = ["stun", "curse", "poison"];
            status = effects[Math.floor(Math.random() * effects.length)];
        } else if (power >= 1.5 && status === "none") {
            const effects = ["poison", "burn", "blind"];
            status = effects[Math.floor(Math.random() * effects.length)];
        }

        console.log(`Parsed → power:${power} element:${element} status:${status}`);

        return res.status(200).json({
            power,
            element,
            effect,
            log_message:   log,
            status_effect: status
        });

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({
            error: 'Internal Server Error',
            details: error.message
        });
    }
}
