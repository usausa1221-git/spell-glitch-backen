export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { spell } = req.body;

        if (!spell) {
            return res.status(400).json({ error: 'No spell provided in request body.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

        // ✅ Gemmaの思考出力からデータを抽出するため、キー名をそのまま書かせる形式に変更
        const prompt =
            "Game: Spell Glitch. Evaluate this spell: \"" + spell + "\"\n\n" +
            "Reply with ONLY these 5 lines, nothing else:\n" +
            "POWER: [number between 0.1 and 5.0]\n" +
            "ELEMENT: [fire/water/thunder/wind/dark/glitch/heal]\n" +
            "EFFECT: [short visual description]\n" +
            "LOG: [flavor text]\n" +
            "STATUS: [none/poison/stun/burn/blind/curse]\n\n" +
            "Rules for POWER: simple spell=0.3-0.7, modified=0.8-1.5, chaotic=2.0-5.0\n" +
            "Rules for STATUS: power<=0.7=none, power0.8-1.4=blind or none, power1.5-2.4=poison or burn or blind, power>=2.5=stun or curse or poison";

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

        // ✅ キーワードベースのパース（JSON不要）
        const extract = (key) => {
            const match = rawAiText.match(new RegExp(key + ':\\s*(.+)', 'i'));
            return match ? match[1].trim() : null;
        };

        const powerStr = extract('POWER');
        const element  = extract('ELEMENT') || 'fire';
        const effect   = extract('EFFECT')  || 'A mysterious energy surges.';
        const log      = extract('LOG')     || 'The spell was cast.';
        const status   = extract('STATUS')  || 'none';

        const power = parseFloat(powerStr) || 0.5;

        // powerが高いのにnoneの場合はサーバー側で補正
        let finalStatus = status.toLowerCase();
        if (power >= 2.5 && finalStatus === "none") {
            const effects = ["stun", "curse", "poison"];
            finalStatus = effects[Math.floor(Math.random() * effects.length)];
        } else if (power >= 1.5 && finalStatus === "none") {
            const effects = ["poison", "burn", "blind"];
            finalStatus = effects[Math.floor(Math.random() * effects.length)];
        }

        return res.status(200).json({
            power:         power,
            element:       element,
            effect:        effect,
            log_message:   log,
            status_effect: finalStatus
        });

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
}
