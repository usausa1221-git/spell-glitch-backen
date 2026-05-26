export default async function handler(req, res) {
    // 1. セキュリティ対策: POSTメソッド以外のリクエストを遮断
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 2. Unityから送信されたスペル（詠唱テキスト）を抽出
        const { spell } = req.body;

        if (!spell) {
            return res.status(400).json({ error: 'No spell provided in request body.' });
        }

        // 3. Vercelのダッシュボードで設定する環境変数からAPIキーを読み込む
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // 4. ゲームデザインに適合させるシステムインストラクション（プロンプト）の定義
        const systemInstruction =
            "You are the backend engine of the game 'Spell Glitch'. " +
            "Evaluate the user's spell input based on: " +
            "1. Original sound retention (Does it sound like a base magic spell?) " +
            "2. Creativity and madness (Does it contain power words like extreme, super, explode?) " +
            "3. Demerits (If power is extremely high, add status penalties). " +
            "You MUST output raw JSON only, matching the exact format: " +
            "{ \"power\": float, \"effect\": \"string\", \"log_message\": \"string\" }";

        // 5. Gemini APIへのリクエストペイロード構築
        const requestPayload = {
            contents: [{ parts: [{ text: spell }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        // 6. Gemini APIへの非同期通信の実行 (Node.js 18+ 標準のfetchを使用)
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            console.error("Gemini API Error Response:", errText);
            return res.status(500).json({ error: 'Failed to communicate with Gemini API.' });
        }

        const responseData = await geminiResponse.json();

        // 7. Geminiの返答テキストを抽出
        let rawAiText = responseData.candidates[0].content.parts[0].text.trim();
        console.log("Raw AI Response:", rawAiText);

        // 8. 頑丈なパース処理 (Robust JSON Cleansing)
        // Geminiがまれに指示を無視して返す "```json ... ```" などのマークダウン装飾を除去
        let cleanedJsonText = rawAiText;
        if (cleanedJsonText.includes("```")) {
            cleanedJsonText = cleanedJsonText
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();
        }

        // 9. クレンジング後のデータをJSONオブジェクト化してUnityへ返却
        const parsedGameResult = JSON.parse(cleanedJsonText);
        return res.status(200).json(parsedGameResult);

    } catch (error) {
        console.error("Internal Server Error Details:", error);
        return res.status(500).json({
            error: 'Internal Server Error',
            details: error.message
        });
    }
}