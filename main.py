from fastapi import FastAPI, UploadFile, File, Form
from pydantic import BaseModel, computed_field
import pandas as pd
import base64
import json
import joblib
import dotenv
import requests
import os

from openai import OpenAI
from fastapi.middleware.cors import CORSMiddleware


# =========================================================
# LOAD .ENV
# =========================================================

dotenv.load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")


# =========================================================
# GROQ CLIENT
# =========================================================

client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1"
)


# =========================================================
# FASTAPI
# =========================================================

app = FastAPI()


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],
)


# =========================================================
# LOAD ML MODEL
# =========================================================

model = joblib.load("ML22.pkl")


# =========================================================
# EXTRACT SOIL DATA
# =========================================================

def extract_soil(soil):

    base64_image = base64.b64encode(
        soil
    ).decode("utf-8")


    prompt = """
Extract ONLY the Test Value for:

N = Available Nitrogen
P = Available Phosphorus
K = Available Potassium
pH = pH

Look only at the SOIL TEST RESULTS table.

Ignore Rating, units, fertilizer recommendations,
and all other values.

Return ONLY JSON:

{
    "N": number,
    "P": number,
    "K": number,
    "pH": number
}

Do not guess. Do not add explanations.
"""


    response = client.responses.create(

        model="qwen/qwen3.8-27b",

        input=[

            {
                "role": "user",

                "content": [

                    {
                        "type": "input_text",
                        "text": prompt
                    },

                    {
                        "type": "input_image",

                        "detail": "auto",

                        "image_url":
                        f"data:image/jpeg;base64,{base64_image}"

                    }

                ]
            }

        ],

        max_output_tokens=200,

        text={
            "format": {
                "type": "json_object"
            }
        }
    )


    print("MODEL OUTPUT:")
    print(response.output_text)


    return json.loads(
        response.output_text
    )


# =========================================================
# GET WEATHER
# =========================================================

def get_weather(latitude, longitude):

    url = "https://api.agromonitoring.com/agro/1.0/weather"

    params = {
        "lat": latitude,
        "lon": longitude,
        "appid": WEATHER_API_KEY,
        "units": "metric"
    }

    response = requests.get(
        url,
        params=params,
        timeout=15
    )

    print("WEATHER STATUS:", response.status_code)
    print("WEATHER RESPONSE:", response.text)

    if response.status_code != 200:
        raise Exception(
            f"Weather API failed: {response.text}"
        )

    weather = response.json()

    temperature = weather["main"]["temp"]
    humidity = weather["main"]["humidity"]

    return {
        "temperature": temperature,
        "humidity": humidity
    }
# =========================================================
# PREPARE DATA
# =========================================================

def predict_type(soil, weather):

    input_df = pd.DataFrame({

        "N": [soil["N"]],

        "P": [soil["P"]],

        "K": [soil["K"]],

        "ph": [soil["pH"]],

        "temperature": [
            weather["temperature"]
        ],

        "humidity": [
            weather["humidity"]
        ]

    })


    return input_df


# =========================================================
# HOME
# =========================================================

@app.get("/")
def hello():

    return {
        "crop": "farmerfriend"
    }


# =========================================================
# PREDICT
# =========================================================

@app.post("/predict")
async def upload(

    file: UploadFile = File(...),

    longitude: float = Form(...),

    latitude: float = Form(...)

):

    print("STEP 1: File received")


    image = await file.read()


    print("STEP 2: Image read")

    print(
        "Image size:",
        len(image)
    )


    soil = extract_soil(
        image
    )


    print("STEP 3: Soil extracted")

    print(
        "Soil:",
        soil
    )


    weather = get_weather(

        latitude,

        longitude

    )


    print("STEP 4: Weather received")

    print(
        "Weather:",
        weather
    )


    input_data = predict_type(

        soil,

        weather

    )


    print("STEP 5: Data prepared")

    print(input_data)


    output = model.predict(
        input_data
    )


    print("STEP 6: Prediction completed")

    print(
        "Prediction:",
        output
    )


    return {

        "soil": soil,

        "weather": weather,

        "crop_predicted": output[0]

    }