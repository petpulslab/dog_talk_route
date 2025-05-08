export const runtime = "edge";
import { NextResponse } from "next/server";
import { EmotionAPI } from "@/constants/api"; // API 키 및 엔드포인트 URL이 정의된 파일

// 서버 설정
export const fetchCache = "force-no-store"; // 캐시 비활성화
export const revalidate = 0; // 항상 재검증
export const dynamic = "force-dynamic"; // 동적 렌더링 강제

// POST: 파일 업로드 및 분석 요청
export async function POST(request: Request) {
  // CORS 헤더 설정을 위한 원본 가져오기
  const origin = request.headers.get("origin") || "*";

  try {
    const formData = await request.formData();
    const file = formData.get("audio_file") as File;
    const userToken = formData.get("user_token") as string; // 외부 JS에서 사용자 토큰을 받아야 함

    if (!file) {
      return NextResponse.json(
        { error: "No audio_file provided" },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }
    if (!userToken) {
      return NextResponse.json(
        { error: "No user_token provided" },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }

    // 파일 타입과 크기 확인
    console.log("[Audio Analysis API - POST] File details:", {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      lastModified: new Date(file.lastModified).toISOString(),
    });

    // 외부 API에 전달할 FormData 생성
    const apiFormData = new FormData();
    apiFormData.append("bark_file", file); // 외부 API가 기대하는 파일 필드명

    console.log("[Audio Analysis API - POST] Upload Request:", {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      userToken: userToken,
      targetApi: EmotionAPI.analysisRequestEmo2,
    });

    // 외부 감정 분석 API에 분석 요청
    const uploadResponse = await fetch(EmotionAPI.analysisRequestEmo2, {
      method: "POST",
      headers: {
        "EMO-Client-ID": EmotionAPI.clientId,
        "EMO-Secret-Key": EmotionAPI.secretKey,
        "X-User-Token": userToken,
      },
      body: apiFormData,
    });

    console.log("[Audio Analysis API - POST] Upload API Response Status:", {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
    });

    if (!uploadResponse.ok) {
      // 응답 텍스트를 얻어 디버깅에 활용
      const errorText = await uploadResponse.text();
      console.error("[Audio Analysis API - POST] Upload Failed:", {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        errorText: errorText.substring(0, 1000), // 로그 크기 제한
      });

      return NextResponse.json(
        {
          success: false,
          error: "Failed to request audio analysis",
          details: errorText.substring(0, 500),
          status: uploadResponse.status,
        },
        {
          status: uploadResponse.status,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }

    // 응답 텍스트를 먼저 얻어 디버깅
    const responseText = await uploadResponse.text();
    console.log(
      "[Audio Analysis API - POST] Upload Raw Response:",
      responseText.substring(0, 1000)
    );

    let uploadResultData;
    try {
      // 텍스트를 JSON으로 파싱
      uploadResultData = JSON.parse(responseText);
    } catch (parseError) {
      console.warn(
        "[Audio Analysis API - POST] Upload response was not valid JSON:",
        parseError,
        "Raw text:",
        responseText.substring(0, 500)
      );

      // 파싱 실패 시 에러 응답
      return NextResponse.json(
        {
          success: false,
          error: "Failed to parse API response",
          details: String(parseError),
          rawResponse: responseText.substring(0, 500),
        },
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
          },
        }
      );
    }

    console.log(
      "[Audio Analysis API - POST] Upload Success Response from external API:",
      JSON.stringify(uploadResultData)
    );

    // API 응답에서 jobId를 추출
    // 실제 API 응답 구조에 맞게 조정 필요
    let jobId = "";

    // 외부 API가 응답으로 ID를 제공하는 경우
    if (uploadResultData && uploadResultData.data && uploadResultData.data.id) {
      jobId = uploadResultData.data.id;
    } else if (uploadResultData && uploadResultData.id) {
      jobId = uploadResultData.id;
    } else {
      // API가 ID를 제공하지 않는 경우, 클라이언트 측에서 관리할 고유 ID 생성
      jobId = `${userToken}_${file.name}_${Date.now()}`;
    }

    console.log("[Audio Analysis API - POST] Generated Job ID:", jobId);

    return NextResponse.json(
      {
        success: true,
        message: "Audio analysis requested. Poll for results using the jobId.",
        jobId: jobId, // 이 jobId를 클라이언트가 결과 조회 시 사용
        fileName: file.name,
        fileSize: file.size,
        apiResponse: uploadResultData, // 디버깅을 위해 API 응답 포함
      },
      {
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      }
    );
  } catch (error) {
    console.error("[Audio Analysis API - POST] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error during analysis request.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
      }
    );
  }
}

// GET: 분석 결과 조회
export async function GET(request: Request) {
  // CORS 헤더 설정을 위한 원본 가져오기
  const origin = request.headers.get("origin") || "*";

  try {
    const url = new URL(request.url);
    // 클라이언트가 jobId와 userToken을 쿼리 파라미터로 제공해야 함
    const jobId = url.searchParams.get("jobId");
    const userToken = url.searchParams.get("userToken"); // 결과 조회 API에 필요

    // 요청 정보 로깅 (디버깅용)
    console.log("[Audio Analysis API - GET] Received request:", {
      jobId,
      userToken,
      timestamp: new Date().toISOString(),
      origin,
    });

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId query parameter is required" },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }
      );
    }
    if (!userToken) {
      return NextResponse.json(
        { error: "userToken query parameter is required" },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }
      );
    }

    console.log(
      `[Audio Analysis API - GET] Result Request for jobId: ${jobId}, userToken: ${userToken}`
    );

    // 외부 감정 분석 결과 API 호출
    // 타임아웃 30초로 설정
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃

    try {
      const resultResponse = await fetch(EmotionAPI.directResultEmo2, {
        // 결과 조회 API URL
        method: "GET", // 보통 결과 조회는 GET
        headers: {
          "EMO-Client-ID": EmotionAPI.clientId,
          "EMO-Secret-Key": EmotionAPI.secretKey,
          Referer: "http://49.247.42.95", // Pippo API가 요구하는 Referer
          "X-User-Token": userToken,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
        cache: "no-store",
        signal: controller.signal, // 타임아웃을 위한 abort signal
      });

      clearTimeout(timeoutId); // 타임아웃 제거

      console.log("[Audio Analysis API - GET] Result API Response Status:", {
        status: resultResponse.status,
        statusText: resultResponse.statusText,
      });

      if (!resultResponse.ok) {
        // 결과가 아직 준비되지 않았거나 (예: 404 Not Found 또는 특정 에러 코드),
        // 실제 에러인 경우를 구분해야 할 수 있습니다.
        const errorText = await resultResponse.text();
        console.warn(
          `[Audio Analysis API - GET] Result API error for jobId ${jobId}: ${resultResponse.status} - ${errorText}`
        );

        // 클라이언트가 폴링을 계속해야 하는지, 아니면 에러로 중단해야 하는지 알려줄 수 있는 상태 반환
        if (resultResponse.status === 404) {
          // 혹은 Pippo API의 "결과 없음" 코드 확인
          return NextResponse.json(
            {
              success: true, // 요청 자체는 성공했으나
              status: "PROCESSING", // 아직 처리 중임을 명시
              message:
                "Analysis result is not_ready_yet. Please try again later.",
              jobId: jobId,
            },
            {
              headers: {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
              },
            }
          );
        }
        // 그 외의 에러는 실패로 간주
        return NextResponse.json(
          {
            error: "Failed to fetch analysis result",
            details: errorText,
            jobId: jobId,
          },
          {
            status: resultResponse.status,
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }

      // 응답 내용을 텍스트로 먼저 얻어서 디버깅에 활용
      const responseText = await resultResponse.text();
      console.log(
        `[Audio Analysis API - GET] Raw response text for jobId ${jobId}:`,
        responseText
      );

      // 텍스트를 JSON으로 파싱
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error(
          `[Audio Analysis API - GET] JSON parse error for jobId ${jobId}:`,
          parseError,
          "Raw text:",
          responseText
        );
        return NextResponse.json(
          {
            success: false,
            error: "Failed to parse API response as JSON",
            details: String(parseError),
            rawText: responseText.substring(0, 500), // 길이 제한
            jobId: jobId,
          },
          {
            status: 500,
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }

      console.log(
        `[Audio Analysis API - GET] Result API Success Response for jobId ${jobId}:`,
        JSON.stringify(data, null, 2)
      );

      // 응답 구조 검증 (실제 응답 구조에 맞게 조정)
      if (
        data &&
        data.data &&
        data.data.content &&
        data.data.content.length > 0
      ) {
        const latestResult = data.data.content[0];

        console.log(
          `[Audio Analysis API - GET] Extracted result for jobId ${jobId}:`,
          latestResult
        );

        const filteredResponse = {
          ansDog: latestResult.ansDog || "",
          ansFilter: latestResult.ansFilter || "",
          fileNameOrigin: latestResult.fileNameOrigin || "",
          startTime: latestResult.startTime || "",
          endTime: latestResult.endTime || "",
        };

        return NextResponse.json(
          {
            success: true,
            status: "COMPLETED",
            result: filteredResponse,
            jobId: jobId,
          },
          {
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      } else if (data && data.code) {
        // API 응답 코드를 기준으로 상태 확인
        console.log(
          `[Audio Analysis API - GET] API returned code ${data.code} for jobId ${jobId}`
        );

        // API 응답 코드에 따른 처리 (실제 API 문서 참조 필요)
        if (
          data.code === "S0005" ||
          data.code === "200" ||
          data.code === "404"
        ) {
          return NextResponse.json(
            {
              success: true,
              status: "PROCESSING",
              message: `Analysis is in progress (Code: ${data.code}). Please try again later.`,
              jobId: jobId,
              apiResponse: data, // 디버깅을 위해 API 응답 추가
            },
            {
              headers: {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
              },
            }
          );
        } else {
          // 기타 API 코드
          return NextResponse.json(
            {
              success: false,
              status: "ERROR",
              message: `API returned unexpected code: ${data.code}`,
              jobId: jobId,
              apiResponse: data,
            },
            {
              headers: {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
              },
            }
          );
        }
      } else {
        // 기타 응답 구조 처리
        console.log(
          `[Audio Analysis API - GET] Unexpected response structure for jobId ${jobId}:`,
          data
        );

        return NextResponse.json(
          {
            success: true,
            status: "NO_CONTENT",
            message: "Analysis result not found or in an unexpected format.",
            jobId: jobId,
            apiResponse: data, // 디버깅을 위해 API 응답 추가
          },
          {
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
            },
          }
        );
      }
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId); // 타임아웃 제거
      console.error(
        `[Audio Analysis API - GET] Fetch error for jobId ${jobId}:`,
        fetchError
      );

      // AbortError인 경우 타임아웃으로 처리
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return NextResponse.json(
          {
            success: true,
            status: "PROCESSING",
            message:
              "Analysis is still in progress. External API timeout. Please try again later.",
            jobId: jobId,
          },
          {
            headers: {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          }
        );
      }

      // 그 외 네트워크 에러
      return NextResponse.json(
        {
          success: false,
          error: "Network error while fetching result",
          details:
            fetchError instanceof Error
              ? fetchError.message
              : String(fetchError),
          jobId: jobId,
        },
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }
      );
    }
  } catch (error) {
    console.error(
      `[Audio Analysis API - GET] Error for jobId (from query):`,
      error
    );

    // 일반적인 에러 응답
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error during result retrieval",
        details: error instanceof Error ? error.message : String(error),
      },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Credentials": "true",
        },
      }
    );
  }
}

// CORS 설정을 위한 OPTIONS 핸들러
export async function OPTIONS(request: Request) {
  // 요청 출처 확인
  const origin = request.headers.get("origin") || "*";

  return new NextResponse(null, {
    status: 204, // No Content
    headers: {
      "Access-Control-Allow-Origin": origin, // 요청을 보낸 출처 허용
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, X-User-Token, EMO-Client-ID, EMO-Secret-Key", // 필요한 헤더 모두 추가
      "Access-Control-Allow-Credentials": "true", // 자격 증명 허용
    },
  });
}
